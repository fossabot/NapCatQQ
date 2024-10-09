import { NapCatLaanaAdapter } from '..';
import { NapCatCore } from '@/core';
import { LaanaActionHandler } from '../action';
import fs from 'fs';
import { ForwardMessagePing_Operation, LaanaPeer, OutgoingMessage } from '@laana-proto/def';

export class LaanaMessageActionImpl {
    constructor(
        public core: NapCatCore,
        public laana: NapCatLaanaAdapter,
    ) {}

    handler: LaanaActionHandler = {
        sendMessage: async (params) => {
            return { msgId: await this.sendMessage(params.message!, params.targetPeer!) };
        },

        getMessage: async (params) => {
            return { message: await this.getMessage(params.msgId) };
        },

        getMessages: async (params) => {
            if (params.msgIds.length === 0) {
                throw new Error('消息 ID 列表不能为空');
            }
            return { messages: await this.getMessages(params.msgIds) };
        },

        getForwardedMessages: async (params) => {
            return {
                forwardMessage: {
                    refId: params.refId,
                    messages: await this.getForwardedMessages(params.refId)
                }
            };
        },

        getHistoryMessages: async (params) => {
            return { messages: await this.getHistoryMessages(params.targetPeer!, params.lastMsgId, params.count) };
        },

        withdrawMessage: async (params) => {
            await this.withdrawMessage(params.msgId);
            return { success: true };
        },

        markPeerMessageAsRead: async (params) => {
            await this.markPeerMessageAsRead(params.peer!);
            return { success: true };
        },

        forwardMessage: async (params) => {
            if (params.msgIds.length === 0) {
                throw new Error('消息 ID 列表不能为空');
            }
            if (params.operation === ForwardMessagePing_Operation.AS_SINGLETONS) {
                await this.forwardMessageAsSingletons(params.msgIds, params.targetPeer!);
            } else {
                await this.forwardMessageAsPacked(params.msgIds, params.targetPeer!);
            }
            return { success: true };
        },
    };

    /**
     * Send a message to a peer.
     * @param msg The message to send.
     * @param targetPeer The peer to send the message to.
     * @returns The Laana-styled msgId of the message sent.
     */
    async sendMessage(msg: OutgoingMessage, targetPeer: LaanaPeer) {
        const { elements, fileCacheRecords } = await this.laana.utils.msg.laanaMessageToRaw(msg, targetPeer);

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
            await this.laana.utils.msg.laanaPeerToRaw(targetPeer),
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
        return this.laana.utils.msg.encodeMsgToLaanaMsgId(
            sentMsgOrEmpty.msgId,
            sentMsgOrEmpty.chatType,
            sentMsgOrEmpty.peerUid,
        );
    }

    /**
     * Get a message by its Laana-styled msgId.
     * @param laanaMsgId The Laana-styled msgId of the message.
     */
    async getMessage(laanaMsgId: string) {
        const { msgId, chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(laanaMsgId);
        const msgListWrapper = await this.core.apis.MsgApi.getMsgsByMsgId(
            { chatType, peerUid, guildId: '' },
            [msgId],
        );
        if (msgListWrapper.msgList.length === 0) {
            throw new Error('消息不存在');
        }
        const msg = msgListWrapper.msgList[0];
        return await this.laana.utils.msg.rawMessageToLaana(msg);
    }

    /**
     * Get multiple messages by their Laana-styled msgIds.
     * This method is optimized for fetching multiple messages at once.
     * @param laanaMsgIds The Laana-styled msgIds of the messages.
     */
    async getMessages(laanaMsgIds: string[]) {
        const msgIdWrappers = laanaMsgIds.map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId));
        // check whether chatType and peerUid for each message are the same
        const firstMsg = msgIdWrappers[0];
        if (msgIdWrappers.some(msg => msg.chatType !== firstMsg.chatType || msg.peerUid !== firstMsg.peerUid)) {
            // one request for each message
            return await Promise.all(msgIdWrappers.map(async ({ msgId, chatType, peerUid }) => {
                const msgListWrapper = await this.core.apis.MsgApi.getMsgsByMsgId(
                    { chatType, peerUid, guildId: '' },
                    [msgId],
                );
                if (msgListWrapper.msgList.length === 0) {
                    throw new Error('消息不存在');
                }
                return await this.laana.utils.msg.rawMessageToLaana(msgListWrapper.msgList[0]);
            }));
        } else {
            // a single request for all messages
            const msgList = (await this.core.apis.MsgApi.getMsgsByMsgId(
                { chatType: firstMsg.chatType, peerUid: firstMsg.peerUid, guildId: '' },
                msgIdWrappers.map(msg => msg.msgId),
            )).msgList;
            return await Promise.all(msgList.map(msg => this.laana.utils.msg.rawMessageToLaana(msg)));
        }
    }

    /**
     * Get forwarded messages by a Laana-styled refId.
     * @param refId The Laana-styled refId of the message.
     */
    async getForwardedMessages(refId: string) {
        const { rootMsgLaanaId, currentMsgId } = this.laana.utils.msg.decodeLaanaForwardMsgRefId(refId);
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
        return await Promise.all(
            rawForwardedMessages.msgList.map(async msg => {
                return await this.laana.utils.msg.rawMessageToLaana(msg, rootMsgLaanaId);
            }),
        );
    }

    /**
     * Get history messages of a peer.
     * @param peer The peer to get history messages from.
     * @param lastMsgId The Laana-styled msgId of the last message.
     * @param count The number of messages to get.
     */
    async getHistoryMessages(peer: LaanaPeer, lastMsgId: string, count: number) {
        const { msgId } = this.laana.utils.msg.decodeLaanaMsgId(lastMsgId);
        const msgListWrapper = await this.core.apis.MsgApi.getMsgHistory(
            await this.laana.utils.msg.laanaPeerToRaw(peer),
            msgId,
            count,
        );
        if (msgListWrapper.msgList.length === 0) {
            this.core.context.logger.logWarn('获取历史消息失败', peer.uin);
        }
        return await Promise.all(
            msgListWrapper.msgList.map(async msg => {
                return await this.laana.utils.msg.rawMessageToLaana(msg);
            }),
        );
    }

    /**
     * Withdraw a message by its Laana-styled msgId.
     * @param laanaMsgId The Laana-styled msgId of the message.
     */
    async withdrawMessage(laanaMsgId: string) {
        const { msgId, chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(laanaMsgId);
        await this.core.apis.MsgApi.recallMsg(
            { chatType, peerUid, guildId: '' },
            msgId,
        );
    }

    /**
     * Mark a peer's messages as read.
     * @param peer The peer to mark messages as read.
     */
    async markPeerMessageAsRead(peer: LaanaPeer) {
        const { chatType, peerUid } = await this.laana.utils.msg.laanaPeerToRaw(peer);
        await this.core.apis.MsgApi.setMsgRead({ chatType, peerUid });
    }

    /**
     * Forward messages as singletons to a target peer.
     * @param laanaMsgIds The Laana-styled msgIds of the messages to forward.
     * @param targetPeer The peer to forward the messages to.
     */
    async forwardMessageAsSingletons(laanaMsgIds: string[], targetPeer: LaanaPeer) {
        const { chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(laanaMsgIds[0]);
        const msgIdList = laanaMsgIds.map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId).msgId);
        const destPeer = await this.laana.utils.msg.laanaPeerToRaw(targetPeer);
        const ret = await this.core.apis.MsgApi.forwardMsg(
            { chatType, peerUid, guildId: '' },
            destPeer,
            msgIdList,
        );
        if (ret.result !== 0) {
            throw new Error(`转发消息失败 ${ret.errMsg}`);
        }
    }

    /**
     * Forward messages as packed to a target peer.
     * @param laanaMsgIds The Laana-styled msgIds of the messages to forward.
     * @param targetPeer The peer to forward the messages to.
     */
    async forwardMessageAsPacked(laanaMsgIds: string[], targetPeer: LaanaPeer) {
        const { chatType, peerUid } = this.laana.utils.msg.decodeLaanaMsgId(laanaMsgIds[0]);
        const msgIdList = laanaMsgIds.map(msgId => this.laana.utils.msg.decodeLaanaMsgId(msgId).msgId);
        const destPeer = await this.laana.utils.msg.laanaPeerToRaw(targetPeer);
        const retMsg = await this.core.apis.MsgApi.multiForwardMsg(
            { chatType, peerUid, guildId: '' },
            destPeer,
            msgIdList,
        );
        return this.laana.utils.msg.encodeMsgToLaanaMsgId(retMsg.msgId, retMsg.chatType, retMsg.peerUid);
    }
}
