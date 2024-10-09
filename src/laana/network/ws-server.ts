import { ILaanaNetworkAdapter } from '../network/index';
import { NapCatLaanaAdapter } from '..';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { Mutex } from 'async-mutex';
import { NapCatCore } from '@/core';
import { LaanaDataWrapper, LaanaEventWrapper, LaanaMessage, LaanaServerSideHandshake_Result } from '@laana-proto/def';

export class LaanaWsServerAdapter implements ILaanaNetworkAdapter {
    wsServer: WebSocketServer;
    wsClients: WebSocket[] = [];
    wsClientsMutex = new Mutex();
    isOpen: boolean = false;
    hasBeenClosed: boolean = false;
    private heartbeatIntervalId: NodeJS.Timeout | null = null;

    constructor(
        public ip: string,
        public port: number,
        public enableHeartbeat: boolean,
        public heartbeatInterval: number,
        public token: string,
        public core: NapCatCore,
        public laana: NapCatLaanaAdapter,
    ) {
        this.wsServer = new WebSocketServer({
            port: port,
            host: ip,
        });
        this.wsServer.on('connection', async (wsClient, request) => {
            if (!this.isOpen) {
                wsClient.close();
                return;
            }
            this.core.context.logger.log(`接收到来自 ${request.socket.remoteAddress} 的连接`);

            wsClient.on('error', (err) =>
                this.core.context.logger.log('连接出现错误', err.message));

            wsClient.once('message', (message) => {
                const data = this.handleRawData(message);
                if (data.data.oneofKind === 'clientSideHandshake') {
                    // TODO: verify protocol version
                    const token = data.data.clientSideHandshake.token;
                    if (token !== this.token) {
                        this.core.context.logger.logWarn(`与 ${request.socket.remoteAddress} 的客户端握手失败，token 不匹配`);
                        this.checkStateAndReply(LaanaDataWrapper.toBinary({
                            data: {
                                oneofKind: 'serverSideHandshake',
                                serverSideHandshake: {
                                    serverVersion: '',
                                    result: LaanaServerSideHandshake_Result.wrongToken,
                                },
                            },
                        }), wsClient);
                        wsClient.close();
                        return;
                    }

                    this.checkStateAndReply(LaanaDataWrapper.toBinary({
                        data: {
                            oneofKind: 'serverSideHandshake',
                            serverSideHandshake: {
                                serverVersion: '',
                                result: LaanaServerSideHandshake_Result.success,
                            },
                        },
                    }), wsClient);
                    this.addClient(wsClient);
                }
            });

            wsClient.on('ping', () => {
                wsClient.pong();
            });

            wsClient.once('close', () => {
                this.wsClientsMutex.runExclusive(async () => {
                    this.wsClients = this.wsClients.filter(client => client !== wsClient);
                });
            });
        });

        this.wsServer.on('error', (err) => {
            this.core.context.logger.log('开启 WebSocket 服务器时出现错误', err);
        });
    }

    onEvent(event: LaanaEventWrapper) {
        this.wsClientsMutex.runExclusive(() => {
            this.wsClients.forEach(wsClient => {
                this.checkStateAndReply(LaanaDataWrapper.toBinary({
                    data: {
                        oneofKind: 'event',
                        event: event,
                    },
                }), wsClient);
            });
        }).catch((e) => this.core.context.logger.logError('事件发送失败', e));
    }

    onMessage(message: LaanaMessage) {
        this.wsClientsMutex.runExclusive(() => {
            this.wsClients.forEach(wsClient => {
                this.checkStateAndReply(LaanaDataWrapper.toBinary({
                    data: {
                        oneofKind: 'message',
                        message: message,
                    },
                }), wsClient);
            });
        }).catch((e) => this.core.context.logger.logError('消息发送失败', e));
    }

    open() {
        if (this.isOpen || this.hasBeenClosed) {
            throw Error('不能重复打开 WebSocket 服务器');
        }

        const addressInfo = this.wsServer.address();
        this.core.context.logger.log(
            'WebSocket 服务器已开启',
            typeof (addressInfo) === 'string' ?
                addressInfo :
                addressInfo?.address + ':' + addressInfo?.port
        );

        this.isOpen = true;
    }

    async close() {
        this.isOpen = false;
        this.wsServer.close();
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
    }

    private handleRawData(message: RawData) {
        let binaryData: Uint8Array;
        if (message instanceof Buffer) {
            binaryData = message;
        } else if (message instanceof ArrayBuffer) {
            binaryData = new Uint8Array(message);
        } else { // message is an array of Buffers
            binaryData = Buffer.concat(message);
        }
        return LaanaDataWrapper.fromBinary(binaryData);
    }

    private async addClient(wsClient: WebSocket) {
        wsClient.on('message', (message) => {
            const data = this.handleRawData(message);

            if (data.data.oneofKind === 'actionPing') {
                const actionName = data.data.actionPing.ping.oneofKind;
                if (actionName === undefined) {
                    return;
                }

                const actionHandler = this.laana.actions[actionName];
                if (!actionHandler) {
                    this.core.context.logger.logError('未实现的动作名', actionName);
                    return;
                }
                try {
                    this.core.context.logger.logDebug('处理动作', actionName);
                    // eslint-disable-next-line
                    // @ts-ignore
                    const ret = await actionHandler(data.data.actionPing.ping[actionName]);
                    this.checkStateAndReply(LaanaDataWrapper.toBinary({
                        data: {
                            oneofKind: 'actionPong',
                            actionPong: {
                                clientPingId: data.data.actionPing.clientPingId,
                                // eslint-disable-next-line
                                // @ts-ignore
                                pong: {
                                    oneofKind: actionName,
                                    [actionName]: ret,
                                },
                            },
                        },
                    }), wsClient);
                } catch (e: any) {
                    this.core.context.logger.logError(`处理动作 ${data.data.oneofKind} 时出现错误`, e);
                    this.checkStateAndReply(LaanaDataWrapper.toBinary({
                        data: {
                            oneofKind: 'actionPong',
                            actionPong: {
                                clientPingId: data.data.actionPing.clientPingId,
                                pong: {
                                    oneofKind: 'failed',
                                    failed: {
                                        reason: e.toString(),
                                    },
                                },
                            },
                        },
                    }), wsClient);
                }
            } else {
                this.core.context.logger.logWarn('未知的数据包类型', data.data.oneofKind);
            }
        });
        await this.wsClientsMutex.runExclusive(async () => {
            this.wsClients.push(wsClient);
        });
    }

    private checkStateAndReply(data: RawData, wsClient: WebSocket) {
        if (wsClient.readyState === WebSocket.OPEN) {
            wsClient.send(data);
        }
    }
}
