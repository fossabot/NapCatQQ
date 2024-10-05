import { ChatType, GrayTipElement, GroupNotify, NapCatCore, RawMessage, TipGroupElement } from '@/core';
import { NapCatEventChannel } from '@/core/events/index';
import fastXmlParser from 'fast-xml-parser';

export class NapCatCoreEventParser {
    constructor(
        public core: NapCatCore,
        private eventChannel: NapCatEventChannel,
    ) {}

    async parseBuddyPoke(grayTipElement: GrayTipElement, msg: RawMessage) {
        const json = JSON.parse(grayTipElement.jsonGrayTipElement.jsonStr);
        const pokeDetail = (json.items as any[]).filter(item => item.uid);
        if (pokeDetail.length == 2) {
            this.eventChannel.emit(
                'buddy/poke',
                await this.core.apis.UserApi.getUinByUidV2(pokeDetail[0].uid),
                await this.core.apis.UserApi.getUinByUidV2(pokeDetail[1].uid)!,
                grayTipElement, msg,
            );
        }
    }

    async parseBuddyAdd(grayTipElement: GrayTipElement, msg: RawMessage) {
        this.eventChannel.emit(
            'buddy/add',
            msg.peerUin,
            grayTipElement, msg
        );
    }

    async parseGroupMemberIncreaseActive(groupElement: TipGroupElement, grayTipElement: GrayTipElement, msg: RawMessage) {
        const member = await this.core.apis.GroupApi.getGroupMember(msg.peerUin, groupElement.memberUid);
        const adminMemberOrEmpty = groupElement.adminUid ?
            await this.core.apis.GroupApi.getGroupMember(msg.peerUin, groupElement.adminUid) :
            undefined;
        this.eventChannel.emit(
            'group/member-increase/active',
            msg.peerUin,
            member!.uin,
            adminMemberOrEmpty?.uin,
            grayTipElement, msg,
        );
    }

    async parseGroupMemberIncreaseInvited(xmlContent: string, grayTipElement: GrayTipElement, msg: RawMessage) {
        const groupCode = msg.peerUin;

        // TODO: analyze the structure of xml content
        const memberUin = xmlContent.match(/uin="(\d+)"/)![1];
        const invitorUin = xmlContent.match(/uin="(\d+)"/)![1];
        this.eventChannel.emit(
            'group/member-increase/invite',
            groupCode,
            memberUin,
            invitorUin,
            grayTipElement, msg,
        );
    }

    async parseGroupShutUp(groupElement: TipGroupElement, grayTipElement: GrayTipElement, msg: RawMessage) {
        const shutUpAttr = groupElement.shutUp!;
        const durationOrLiftBan = parseInt(shutUpAttr.duration);
        if (shutUpAttr.member?.uid) {
            if (durationOrLiftBan > 0) {
                this.eventChannel.emit(
                    'group/shut-up/put',
                    msg.peerUin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.member.uid))!.uin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.admin.uid))!.uin,
                    durationOrLiftBan,
                    grayTipElement, msg,
                );
            } else {
                this.eventChannel.emit(
                    'group/shut-up/lift',
                    msg.peerUin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.member.uid))!.uin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.admin.uid))!.uin,
                    grayTipElement, msg,
                );
            }
        } else {
            if (durationOrLiftBan > 0) {
                this.eventChannel.emit(
                    'group/shut-up-all/put',
                    msg.peerUin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.admin.uid))!.uin,
                    grayTipElement, msg,
                );
            } else {
                this.eventChannel.emit(
                    'group/shut-up-all/lift',
                    msg.peerUin,
                    (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, shutUpAttr.admin.uid))!.uin,
                    grayTipElement, msg,
                );
            }
        }
    }
    
    async parseGroupMemberDecreaseSelf(groupElement: TipGroupElement, grayTipElement: GrayTipElement, msg: RawMessage) {
        const adminUin =
            (await this.core.apis.GroupApi.getGroupMember(msg.peerUin, groupElement.adminUid))?.uin ??
            (await this.core.apis.UserApi.getUinByUidV2(groupElement.adminUid));
        if (adminUin) {
            this.eventChannel.emit(
                'group/member-decrease/self-kicked',
                msg.peerUin,
                adminUin,
                grayTipElement, msg,
            );
        } else {
            this.eventChannel.emit(
                'group/member-decrease/unknown',
                msg.peerUin,
                this.core.selfInfo.uin,
                undefined,
                grayTipElement, msg,
            );
        }
    }

    async parseGroupPoke(parsedJson: ReturnType<JSON['parse']>, grayTipElement: GrayTipElement, msg: RawMessage) {
        const pokeDetail = (parsedJson.items as any[]).filter(item => item.uid);
        if (pokeDetail.length == 2) {
            this.eventChannel.emit(
                'group/poke',
                msg.peerUin,
                await this.core.apis.UserApi.getUinByUidV2(pokeDetail[0].uid),
                await this.core.apis.UserApi.getUinByUidV2(pokeDetail[1].uid)!,
                grayTipElement, msg,
            );
        }
    }

    async parseGroupSpecialTitleChange(parsedJson: ReturnType<JSON['parse']>, grayTipElement: GrayTipElement, msg: RawMessage) {
        const memberUin = parsedJson.items[1].param[0];
        const title = parsedJson.items[3].txt;
        this.eventChannel.emit(
            'group/title',
            msg.peerUin,
            memberUin,
            title,
            grayTipElement, msg,
        );
    }

    async parseGroupEssence(parsedJson: ReturnType<JSON['parse']>, grayTipElement: GrayTipElement, msg: RawMessage) {
        const searchParams = new URL(parsedJson.items[0].jp).searchParams;
        const msgSeq = searchParams.get('msgSeq')!;
        const Group = searchParams.get('groupCode');
        const msgData = await this.core.apis.MsgApi.getMsgsBySeqAndCount({
            guildId: '',
            chatType: ChatType.KCHATTYPEGROUP,
            peerUid: Group!,
        }, msgSeq.toString(), 1, true, true);
        this.eventChannel.emit(
            'group/essence',
            msg.peerUid,
            msgData.msgList[0].msgId,
            'add',
            grayTipElement, msg,
        );
    }

    async parseGroupEmojiLike(xmlContent: string, grayTipElement: GrayTipElement, msg: RawMessage) {
        const emojiLikeData = new fastXmlParser.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
        }).parse(xmlContent);
        const groupCode = msg.peerUin;
        const senderUin = emojiLikeData.gtip.qq.jp;
        const msgSeq = emojiLikeData.gtip.url.msgseq;
        const emojiId = emojiLikeData.gtip.face.id;

        const peer = {
            chatType: ChatType.KCHATTYPEGROUP,
            guildId: '',
            peerUid: groupCode,
        };
        const replyMsgList = (await this.core.apis.MsgApi.getMsgExBySeq(peer, msgSeq)).msgList;
        if (replyMsgList.length < 1) {
            return null;
        }
        const replyMsg = replyMsgList
            .filter(e => e.msgSeq == msgSeq)
            .sort((a, b) => parseInt(a.msgTime) - parseInt(b.msgTime))[0];

        if (!replyMsg) {
            this.core.context.logger.logError('解析表情回应消息失败: 未找到回应消息');
            return null;
        }

        const likedMsgId = replyMsg.msgId;
        if (!likedMsgId) {
            this.core.context.logger.logError('解析表情回应消息失败: 未找到回应消息');
        } else {
            this.eventChannel.emit(
                'group/emoji-like',
                groupCode,
                senderUin,
                likedMsgId,
                [{ emojiId, count: 1 }],
                grayTipElement, msg,
            );
        }
    }

    async parseGroupAdminSet(notify: GroupNotify) {
        this.eventChannel.emit(
            'group/admin',
            notify.group.groupCode,
            (await this.core.apis.GroupApi.getGroupMember(notify.group.groupCode, notify.user1.uid))!.uin,
            'set',
            notify,
        );
    }

    async parseGroupAdminUnset(notify: GroupNotify) {
        this.eventChannel.emit(
            'group/admin',
            notify.group.groupCode,
            (await this.core.apis.GroupApi.getGroupMember(notify.group.groupCode, notify.user1.uid))!.uin,
            'unset',
            notify,
        );
    }

    async parseGroupMemberDecreaseFromNotify(notify: GroupNotify) {
        const leftMemberUin = await this.core.apis.UserApi.getUinByUidV2(notify.user1.uid);
        if (notify.user2.uid) {
            // Has an operator, indicates that the member is kicked
            const operatorUin = await this.core.apis.UserApi.getUinByUidV2(notify.user2.uid);
            if (!operatorUin) {
                this.core.context.logger.logError('获取操作者 QQ 号失败');
                this.eventChannel.emit(
                    'group/member-decrease/unknown',
                    notify.group.groupCode,
                    leftMemberUin,
                    notify,
                );
            } else {
                this.eventChannel.emit(
                    'group/member-decrease/kick',
                    notify.group.groupCode,
                    leftMemberUin,
                    operatorUin,
                    notify,
                );
            }
        } else {
            // No operator, indicates that the member leaves
            this.eventChannel.emit(
                'group/member-decrease/leave',
                notify.group.groupCode,
                leftMemberUin,
                notify
            );
        }
    }

    async parseGroupJoinRequest(notify: GroupNotify) {
        this.eventChannel.emit(
            'group/request',
            notify.group.groupCode,
            await this.core.apis.UserApi.getUinByUidV2(notify.user1.uid),
            notify.postscript,
            notify
        );
    }

    async parseGroupJoinInvitation(notify: GroupNotify) {
        this.eventChannel.emit(
            'group/invite',
            notify.group.groupCode,
            await this.core.apis.UserApi.getUinByUidV2(notify.user1.uid),
            notify
        );
    }
}
