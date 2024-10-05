import EventEmitter from 'node:events';
import TypedEmitter from 'typed-emitter/rxjs';
import {
    BuddyReqType,
    ChatType, DataSource, GroupMemberRole, GroupNotifyMsgStatus, GroupNotifyMsgType,
    NapCatCore, NodeIKernelBuddyListener, NodeIKernelGroupListener,
    NodeIKernelMsgListener,
    NTGrayTipElementSubTypeV2,
    RawMessage,
    SendStatusType, TipGroupElementType,
} from '@/core';
import { LRUCache } from '@/common/lru-cache';
import { proxiedListenerOf } from '@/common/proxy-handler';
import { NapCatInternalEvents } from './definition';
import { NapCatCoreEventParser } from '@/core/events/parser';
import { Mutex } from 'async-mutex';

export class NapCatEventChannel extends
    // eslint-disable-next-line
    // @ts-ignore
    (EventEmitter as new () => TypedEmitter<NapCatInternalEvents>) {
    private parser: NapCatCoreEventParser;

    constructor(public core: NapCatCore) {
        super();

        this.parser = new NapCatCoreEventParser(core, this);

        this.initMsgListener();
        this.initBuddyListener();
        this.initGroupListener();
    }

    private initMsgListener() {
        const msgListener = new NodeIKernelMsgListener();

        msgListener.onRecvMsg = msgList => {
            Promise.allSettled(
                msgList.filter(msg => msg.senderUin !== this.core.selfInfo.uin)
                    .map(msg => {
                        this.parseRawMsgToEventAndEmit(msg)
                            .then(handled => {
                                if (!handled) this.emit('message/receive', msg);
                            });
                    }),
            )
                .then(results => {
                    results.filter(result => result.status === 'rejected')
                        .forEach(result => {
                            this.core.context.logger.logError('处理消息失败', result.reason);
                        });
                });
        };

        const msgIdSentCache = new LRUCache<string, boolean>(100);
        const msgIdSentCacheMutex = new Mutex();
        const recallMsgCache = new LRUCache<string, boolean>(100);
        const recallMsgCacheMutex = new Mutex();

        msgListener.onMsgInfoListUpdate = async msgList => {
            Promise.allSettled(msgList.map(async msg => {
                // Handle message recall
                if (msg.recallTime !== '0' && !recallMsgCache.get(msg.msgId)) {
                    await recallMsgCacheMutex.runExclusive(() => recallMsgCache.put(msg.msgId, true));
                    if (msg.chatType === ChatType.KCHATTYPEC2C) {
                        this.emit('buddy/recall', msg.peerUin, msg.msgId, msg);
                    } else if (msg.chatType == ChatType.KCHATTYPEGROUP) {
                        let operatorId = msg.senderUin;
                        for (const element of msg.elements) {
                            const operatorUid = element.grayTipElement?.revokeElement.operatorUid;
                            if (!operatorUid) return;
                            const operator = await this.core.apis.GroupApi.getGroupMember(msg.peerUin, operatorUid);
                            operatorId = operator?.uin || msg.senderUin;
                        }
                        this.emit('group/recall', msg.peerUin, operatorId, msg.msgId, msg);
                    }
                }

                // Handle message send
                else if (msg.sendStatus === SendStatusType.KSEND_STATUS_SUCCESS && !msgIdSentCache.get(msg.msgId)) {
                    await msgIdSentCacheMutex.runExclusive(() => msgIdSentCache.put(msg.msgId, true));
                    const handled = await this.parseRawMsgToEventAndEmit(msg);
                    if (!handled) this.emit('message/send', msg);
                }
            }))
                .then(results => {
                    results.filter(result => result.status === 'rejected')
                        .forEach(result => {
                            this.core.context.logger.logError('处理消息失败', result.reason);
                        });
                });
        };

        msgListener.onInputStatusPush = async data => {
            this.emit('buddy/input-status', data);
        };

        this.core.context.session.getMsgService().addKernelMsgListener(
            proxiedListenerOf(msgListener, this.core.context.logger) as any,
        );
    }

    private async parseRawMsgToEventAndEmit(msg: RawMessage) {
        if (msg.chatType === ChatType.KCHATTYPEC2C) {
            for (const element of msg.elements) {
                if (element.grayTipElement) {
                    if (element.grayTipElement.subElementType == NTGrayTipElementSubTypeV2.GRAYTIP_ELEMENT_SUBTYPE_JSON) {
                        if (element.grayTipElement.jsonGrayTipElement.busiId == 1061) {
                            await this.parser.parseBuddyPoke(element.grayTipElement, msg);
                            return true;
                        }
                    }

                    if (element.grayTipElement.subElementType == NTGrayTipElementSubTypeV2.GRAYTIP_ELEMENT_SUBTYPE_XMLMSG) {
                        if (element.grayTipElement.xmlElement.templId === '10229' && msg.peerUin !== '') {
                            await this.parser.parseBuddyAdd(element.grayTipElement, msg);
                            return true;
                        }
                    }
                }
            }
        } else if (msg.chatType === ChatType.KCHATTYPEGROUP) {
            for (const element of msg.elements) {
                const grayTipElement = element.grayTipElement;

                if (grayTipElement) {
                    if (grayTipElement.groupElement) {
                        const groupElement = grayTipElement.groupElement;

                        if (groupElement.type === TipGroupElementType.memberIncrease) {
                            await this.parser.parseGroupMemberIncreaseActive(groupElement, grayTipElement, msg);
                            return true;
                        }

                        if (groupElement.type === TipGroupElementType.ban) {
                            await this.parser.parseGroupShutUp(groupElement, grayTipElement, msg);
                            return true;
                        }

                        if (groupElement.type == TipGroupElementType.kicked) {
                            await this.core.apis.GroupApi.quitGroup(msg.peerUin);
                            await this.parser.parseGroupMemberDecreaseSelf(groupElement, grayTipElement, msg);
                            return true;
                        }
                    }

                    if (grayTipElement.xmlElement) {
                        const xmlContent = grayTipElement.xmlElement.content;

                        if (grayTipElement.xmlElement.templId === '10382') {
                            await this.parser.parseGroupEmojiLike(xmlContent, grayTipElement, msg);
                            return true;
                        }

                        { // Todo: What is the temp id for group member increase?
                            await this.parser.parseGroupMemberIncreaseInvited(xmlContent, grayTipElement, msg);
                            return true;
                        }
                    }

                    if (grayTipElement.subElementType === NTGrayTipElementSubTypeV2.GRAYTIP_ELEMENT_SUBTYPE_JSON) {
                        const parsedJson = JSON.parse(grayTipElement.jsonGrayTipElement.jsonStr);

                        if (grayTipElement.jsonGrayTipElement.busiId === 1061) {
                            await this.parser.parseGroupPoke(parsedJson, grayTipElement, msg);
                            return true;
                        }

                        if (grayTipElement.jsonGrayTipElement.busiId === 2401) {
                            await this.parser.parseGroupEssence(parsedJson, grayTipElement, msg);
                            return true;
                        }

                        if (grayTipElement.jsonGrayTipElement.busiId === 2407) {
                            await this.parser.parseGroupSpecialTitleChange(parsedJson, grayTipElement, msg);
                            return true;
                        }
                    }
                }

                if (element.fileElement) {
                    this.emit(
                        'group/upload',
                        msg.peerUin,
                        msg.senderUin,
                        element.fileElement, msg,
                    );
                }
            }
        }

        return false;
    }

    private initBuddyListener() {
        const buddyListener = new NodeIKernelBuddyListener();

        buddyListener.onBuddyReqChange = async reqs => {
            await this.core.apis.FriendApi.clearBuddyReqUnreadCnt();
            for (let i = 0; i < reqs.unreadNums; i++) {
                const req = reqs.buddyReqs[i];
                if (req.isInitiator || (req.isDecide && req.reqType !== BuddyReqType.KMEINITIATORWAITPEERCONFIRM)) {
                    continue;
                }
                try {
                    const reqUin = await this.core.apis.UserApi.getUinByUidV2(req.friendUid);
                    this.emit('buddy/request', reqUin, req.extWords, req);
                } catch (e) {
                    this.core.context.logger.logDebug('获取加好友者 QQ 号失败', e);
                }
            }
        };

        this.core.context.session.getBuddyService().addKernelBuddyListener(
            proxiedListenerOf(buddyListener, this.core.context.logger) as any,
        );
    }

    private initGroupListener() {
        const groupListener = new NodeIKernelGroupListener();

        groupListener.onGroupNotifiesUpdated = async (_, notifies) => {
            Promise.allSettled(notifies.map(async notify => {
                if (notify.type === GroupNotifyMsgType.SET_ADMIN) {
                    await this.parser.parseGroupAdminSet(notify);
                    return;
                }

                if (notify.type === GroupNotifyMsgType.CANCEL_ADMIN_NOTIFY_ADMIN ||
                    notify.type === GroupNotifyMsgType.CANCEL_ADMIN_NOTIFY_CANCELED) {
                    await this.parser.parseGroupAdminUnset(notify);
                    return;
                }

                if (notify.type === GroupNotifyMsgType.MEMBER_LEAVE_NOTIFY_ADMIN) {
                    await this.parser.parseGroupMemberDecreaseFromNotify(notify);
                    return;
                }

                if (notify.type === GroupNotifyMsgType.REQUEST_JOIN_NEED_ADMINI_STRATOR_PASS &&
                    notify.status === GroupNotifyMsgStatus.KUNHANDLE) {
                    await this.parser.parseGroupJoinRequest(notify);
                    return;
                }

                if (notify.type == GroupNotifyMsgType.INVITED_BY_MEMBER &&
                    notify.status == GroupNotifyMsgStatus.KUNHANDLE) {
                    await this.parser.parseGroupJoinInvitation(notify);
                    return;
                }
            }))
                .then(results => {
                    results.filter(result => result.status === 'rejected')
                        .forEach(result => {
                            this.core.context.logger.logError('处理群通知失败', result.reason);
                        });
                });
        };

        groupListener.onMemberInfoChange = async (groupCode, dataSource, members) => {
            if (dataSource === DataSource.LOCAL) {
                const existMembers = this.core.apis.GroupApi.groupMemberCache.get(groupCode);
                if (!existMembers) return;
                members.forEach(member => {
                    const existMember = existMembers.get(member.uid);
                    if (!existMember?.isChangeRole) return;
                    this.core.context.logger.logDebug('变动管理员', member);
                    this.emit(
                        'group/admin',
                        groupCode,
                        member.uin,
                        member.role === GroupMemberRole.admin ? 'set' : 'unset',
                    );
                });
            }
        };

        this.core.context.session.getGroupService().addKernelGroupListener(
            proxiedListenerOf(groupListener, this.core.context.logger),
        );
    }
}
