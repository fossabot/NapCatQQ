import { NapCatCore, Sex } from '@/core';
import { NapCatLaanaAdapter } from '@/laana';
import { LaanaUserEntity, LaanaGroup, LaanaUserEntity_Sex } from '@laana-proto/def';
import { LaanaActionHandler } from '@/laana/action/index';

export class LaanaContactActionImpl {
    constructor(
        public core: NapCatCore,
        public laana: NapCatLaanaAdapter,
    ) {}

    handler: LaanaActionHandler = {
        getAllBuddies: async () => ({
            buddyUins: await this.getAllBuddies(),
        }),

        getAllGroups: async () => ({
            groupCodes: await this.getAllGroups(),
        }),

        getBuddyInfo: async ({ buddyUin }) => ({
            buddy: await this.getBuddyInfo(buddyUin),
        }),

        getGroupInfo: async ({ groupCode }) => ({
            group: await this.getGroupInfo(groupCode),
        }),
    };

    /**
     * Get all buddies' uin.
     */
    async getAllBuddies() {
        return (await this.core.apis.FriendApi.getBuddyV2())
            .map(value => value.uin)
            .filter(value => value !== undefined);
    }

    /**
     * Get all groups' groupCode.
     */
    async getAllGroups() {
        return Array.from(
            (await this.core.apis.GroupApi.getGroups()).values()
        ).map(value => value.groupCode);
    }

    /**
     * Get buddy info.
     * @param uin Buddy uin.
     */
    async getBuddyInfo(uin: string): Promise<LaanaUserEntity> {
        const uid = await this.core.apis.UserApi.getUidByUinV2(uin);
        if (!uid) {
            throw new Error(`获取 ${uin} 信息失败`);
        }
        const userInfo = await this.core.apis.UserApi.getUserDetailInfo(uid);
        return {
            uin,
            nick: userInfo.nick,
            sex: userInfo.sex === Sex.male ? LaanaUserEntity_Sex.MALE
                : userInfo.sex === Sex.female ? LaanaUserEntity_Sex.FEMALE
                    : LaanaUserEntity_Sex.UNKNOWN,
            age: userInfo.age,
            qid: userInfo.qid,
            roleData: {
                oneofKind: 'buddyRoleData',
                buddyRoleData: {
                    remark: userInfo.remark,
                },
            },
        };
    }

    /**
     * Get group info.
     * @param groupCode Group code.
     */
    async getGroupInfo(groupCode: string): Promise<LaanaGroup> {
        const groupInfo = await this.core.apis.GroupApi.getGroup(groupCode);
        if (!groupInfo) {
            throw new Error(`获取 ${groupCode} 信息失败`);
        }
        return {
            groupCode,
            groupName: groupInfo.groupName,
            groupRemark: groupInfo.remarkName,
            memberCount: groupInfo.memberCount,
            maxMemberCount: groupInfo.maxMember,
        };
    }
}
