import { FileElement, FriendRequest, GrayTipElement, GroupNotify, NodeIKernelMsgListener, RawMessage } from '@/core';

export type NapCatInternalEvents = {
    'message/receive': (msg: RawMessage) => PromiseLike<void>;

    'message/send': (msg: RawMessage) => PromiseLike<void>;


    'buddy/request': (uid: string, words: string,
                      xRequest: FriendRequest) => PromiseLike<void>;

    'buddy/add': (uin: string,
                  xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'buddy/poke': (initiatorUin: string, targetUin: string,
                   xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'buddy/recall': (uin: string, messageId: string,
                     xMsg: RawMessage /* This is not the message that is recalled */) => PromiseLike<void>;

    'buddy/input-status': (data: Parameters<NodeIKernelMsgListener['onInputStatusPush']>[0]) => PromiseLike<void>;


    'group/request': (groupCode: string, requestUin: string, words: string,
                      xGroupNotify: GroupNotify) => PromiseLike<void>;

    'group/invite': (groupCode: string, invitorUin: string,
                     xGroupNotify: GroupNotify) => PromiseLike<void>;

    'group/admin': (groupCode: string, targetUin: string, operation: 'set' | 'unset',
                    // If it comes from onGroupNotifiesUpdated
                    xGroupNotify?: GroupNotify,
                    // If it comes from onMemberInfoChange
                    xDataSource?: RawMessage, xMsg?: RawMessage) => PromiseLike<void>;


    'group/shut-up/put': (groupCode: string, targetUin: string, operatorUin: string, duration: number,
                          xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/shut-up/lift': (groupCode: string, targetUin: string, operatorUin: string,
                           xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/shut-up-all/put': (groupCode: string, operatorUin: string,
                              xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/shut-up-all/lift': (groupCode: string, operatorUin: string,
                               xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/card-change': (groupCode: string, changedUin: string, newCard: string, oldCard: string,
                          xMsg: RawMessage) => PromiseLike<void>;

    'group/member-increase/invite': (groupCode: string, newMemberUin: string, invitorUin: string,
                                     xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/member-increase/active': (groupCode: string, newMemberUin: string, approvalUin: string | undefined,
                                     xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/member-decrease/kick': (groupCode: string, leftMemberUin: string, operatorUin: string,
                                   xGroupNotify: GroupNotify) => PromiseLike<void>;

    'group/member-decrease/self-kicked': (groupCode: string, operatorUin: string,
                                          xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/member-decrease/leave': (groupCode: string, leftMemberUin: string,
                                    xGroupNotify: GroupNotify) => PromiseLike<void>;

    'group/member-decrease/unknown': (groupCode: string, leftMemberUin: string,
                                      // If it comes from onGroupNotifiesUpdated
                                      xGroupNotify?: GroupNotify,
                                      // If it comes from onRecvSysMsg
                                      xGrayTipElement?: GrayTipElement, xMsg?: RawMessage) => PromiseLike<void>;

    'group/essence': (groupCode: string, messageId: string, operation: 'add' | 'delete',
                      xGrayTipElement: GrayTipElement,
                      xGrayTipSourceMsg: RawMessage /* this is not the message that is set to be essence msg */) => PromiseLike<void>;

    'group/recall': (groupCode: string, operatorUin: string, messageId: string,
                     xGrayTipSourceMsg: RawMessage /* This is not the message that is recalled */) => PromiseLike<void>;

    'group/title': (groupCode: string, targetUin: string, newTitle: string,
                    xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;

    'group/upload': (groupCode: string, uploaderUin: string, fileElement: FileElement,
                     xMsg: RawMessage) => PromiseLike<void>;

    'group/emoji-like': (groupCode: string, operatorUin: string, messageId: string, likes: { emojiId: string, count: number }[],
                         // If it comes from onRecvMsg
                         xGrayTipElement?: GrayTipElement, xMsg?: RawMessage,
                         // If it comes from onRecvSysMsg
                         xSysMsg?: number[]) => PromiseLike<void>;

    'group/poke': (groupCode: string, initiatorUin: string, targetUin: string,
                   xGrayTipElement: GrayTipElement, xMsg: RawMessage) => PromiseLike<void>;
}
