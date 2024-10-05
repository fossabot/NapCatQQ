import { NapCatLaanaAdapter } from '..';
import { NapCatCore } from '@/core';
import { LaanaActionHandler } from '../action';
import fs from 'fs';
import { ForwardMessagePing_Operation } from '@laana-proto/def';

// TODO: separate implementation and handler
export class LaanaMessageActionHandler {
    constructor(
        public core: NapCatCore,
        public laana: NapCatLaanaAdapter,
    ) {}

    impl: LaanaActionHandler = {
        sendMessage: async (params) => {
            const { elements, fileCacheRecords } = await this.laana.utils.msg.laanaMessageToRaw(params.message!, params);

            let cacheSize = 0;
            try {
                for (const cacheRecord of fileCacheRecords) {
                    cacheSize += fs.statSync(await this.laana.utils.file.toLocalPath(cacheRecord.cacheId)).size;
                }
            } catch (e) {
                this.core.context.logger.logWarn('文件缓存大小计算失败', e);
            }
            const estimatedSendMsgTimeout =
                cacheSize / 1024 / 256 * 1000 + // file upload time
                1000 * fileCacheRecords.length + // request timeout
                10000; // fallback timeout

            const sentMsgOrEmpty = await this.core.apis.MsgApi.sendMsg(
                await this.laana.utils.msg.laanaPeerToRaw(params.targetPeer!),
                elements,
                true, // TODO: add 'wait complete' (bool) field
                estimatedSendMsgTimeout,
            );

            fileCacheRecords.forEach(record => {
                if (record.originalType !== 'cacheId') {
                    this.laana.utils.file.destroyCache(record.cacheId);
                }
            });

            if (!sentMsgOrEmpty) {
                throw Error('消息发送失败');
            }
            return {
                msgId: this.laana.utils.msg.encodeMsgToLaanaMsgId(
                    sentMsgOrEmpty.msgId,
                    sentMsgOrEmpty.chatType,
                    sentMsgOrEmpty.peerUid,
                ),
            };
        },

        sendPackedMessages: async (params) => {
            // first send every single message to self, then forward them to target peer

            // send message one by one
            const sendMsgIds: string[] = [];
            for (const message of params.messages) {
                sendMsgIds.push((await this.impl.sendMessage!({ targetPeer: params.targetPeer, message })).msgId);
            }

            await this.impl.forwardMessage!({
                msgIds: sendMsgIds,
                targetPeer: params.targetPeer,
                operation: ForwardMessagePing_Operation.AS_PACKED,
            });

            return {
                packedMsgId: '', // unimplemented
                msgIds: sendMsgIds,
            };
        },

        getMessage: async (params) => {
            const { msgId, chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(params.msgId);
            const msgListWrapper = await this.core.apis.MsgApi.getMsgsByMsgId(
                { chatType, peerUid, guildId: '' },
                [msgId],
            );
            if (msgListWrapper.msgList.length === 0) {
                throw new Error('消息不存在');
            }
            const msg = msgListWrapper.msgList[0];
            return {
                message: await this.laana.utils.msg.rawMessageToLaana(msg),
            };
        },

        getMessages: async (params) => {
            if (params.msgIds.length === 0) {
                throw new Error('消息 ID 列表不能为空');
            }

            const msgIdWrappers = params.msgIds.map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId));

            // check whether chatType and peerUid for each message are the same
            const firstMsg = msgIdWrappers[0];
            if (msgIdWrappers.some(msg => msg.chatType !== firstMsg.chatType || msg.peerUid !== firstMsg.peerUid)) {
                return {
                    // one request per message
                    messages: await Promise.all(
                        params.msgIds.map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId))
                            .map(async ({ msgId, chatType, peerUid }) => {
                                const msgListWrapper = await this.core.apis.MsgApi.getMsgsByMsgId(
                                    { chatType, peerUid, guildId: '' },
                                    [msgId],
                                );
                                if (msgListWrapper.msgList.length === 0) {
                                    throw new Error('消息不存在');
                                }
                                return await this.laana.utils.msg.rawMessageToLaana(msgListWrapper.msgList[0]);
                            })
                    )
                };
            } else {
                // a single request for all messages
                const msgListWrapper = await this.core.apis.MsgApi.getMsgsByMsgId(
                    { chatType: firstMsg.chatType, peerUid: firstMsg.peerUid, guildId: '' },
                    msgIdWrappers.map(msg => msg.msgId),
                );
                return {
                    messages: await Promise.all(
                        msgListWrapper.msgList.map(msg => this.laana.utils.msg.rawMessageToLaana(msg)),
                    ),
                };
            }
        },

        getForwardedMessages: async (params) => {
            const { rootMsgLaanaId, currentMsgId } = this.laana.utils.msg.decodeLaanaForwardMsgRefId(params.refId);
            const decodedRootMsgId = this.laana.utils.msg.decodeLaanaMsgId(rootMsgLaanaId);
            const rawForwardedMessages = await this.core.apis.MsgApi.getMultiMsg(
                {
                    chatType: decodedRootMsgId.chatType,
                    peerUid: decodedRootMsgId.peerUid,
                    guildId: '',
                },
                decodedRootMsgId.msgId,
                currentMsgId,
            );
            if (!rawForwardedMessages || rawForwardedMessages.result !== 0 || rawForwardedMessages.msgList.length === 0) {
                throw new Error('获取转发消息失败');
            }
            return {
                forwardMessage: {
                    refId: params.refId,
                    messages: await Promise.all(
                        rawForwardedMessages.msgList.map(async msg => {
                            return await this.laana.utils.msg.rawMessageToLaana(msg, rootMsgLaanaId);
                        }),
                    ),
                }
            };
        },

        getHistoryMessages: async (params) => { // TODO: add 'reverseOrder' field
            const { msgId } = this.laana.utils.msg.decodeLaanaMsgId(params.lastMsgId);
            const msgListWrapper = await this.core.apis.MsgApi.getMsgHistory(
                await this.laana.utils.msg.laanaPeerToRaw(params.targetPeer!),
                msgId,
                params.count,
            );
            if (msgListWrapper.msgList.length === 0) {
                this.core.context.logger.logWarn('获取历史消息失败', params.targetPeer!.uin);
            }
            return { // TODO: check order
                messages: await Promise.all(
                    msgListWrapper.msgList.map(async msg => {
                        return await this.laana.utils.msg.rawMessageToLaana(msg);
                    }),
                ),
            };
        },

        withdrawMessage: async (params) => {
            const { msgId, chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(params.msgId);
            try {
                await this.core.apis.MsgApi.recallMsg(
                    { chatType, peerUid, guildId: '' },
                    msgId,
                );
            } catch (e) {
                throw new Error(`消息撤回失败: ${e}`);
            }
            return { success: true };
        },

        markPeerMessageAsRead: async (params) => {
            const { chatType, peerUid } = await this.laana.utils.msg.laanaPeerToRaw(params.peer!);
            try {
                await this.core.apis.MsgApi.setMsgRead({ chatType, peerUid });
            } catch (e) {
                throw new Error(`标记消息已读失败: ${e}`);
            }
            return { success: true };
        },

        forwardMessage: async (params) => {
            if (params.msgIds.length === 0) {
                throw new Error('消息 ID 列表不能为空');
            }
            const { chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(params.msgIds[0]);
            const msgIdList = params.msgIds
                .map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId).msgId);
            const destPeer = await this.laana.utils.msg.laanaPeerToRaw(params.targetPeer!);

            if (params.operation === ForwardMessagePing_Operation.AS_SINGLETONS) {
                const ret = await this.core.apis.MsgApi.forwardMsg(
                    { chatType, peerUid, guildId: '' },
                    destPeer,
                    msgIdList,
                );
                if (ret.result !== 0) {
                    throw new Error(`转发消息失败 ${ret.errMsg}`);
                }
            } else {
                throw new Error('unimplemented');
                // TODO: refactor NTQQMsgApi.multiForwardMsg
            }

            return { success: true };
        },
    };
}
