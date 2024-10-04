import { NapCatLaanaAdapter } from '..';
import { randomUUID } from 'crypto';
import { LaanaEventWrapper, LaanaMessage } from '@laana-proto/def';

export interface ILaanaNetworkAdapter {
    laana: NapCatLaanaAdapter;

    onEvent(event: LaanaEventWrapper): void;

    onMessage(message: LaanaMessage): void;

    open(): void | Promise<void>;

    close(): void | Promise<void>;
}

export class LaanaNetworkManager {
    adapters: ILaanaNetworkAdapter[] = [];

    async openAllAdapters() {
        return Promise.all(this.adapters.map(adapter => adapter.open()));
    }

    emitEvent<T extends Exclude<LaanaEventWrapper['event']['oneofKind'], undefined>>(
        eventName: T,
        // eslint-disable-next-line
        // @ts-ignore
        event: Extract<EventWrapper['event'], { oneofKind: T }>[T]
    ) {
        return Promise.all(this.adapters.map(adapter => adapter.onEvent({
            time: BigInt(Date.now()),
            eventId: randomUUID(),
            // eslint-disable-next-line
            // @ts-ignore
            event: {
                oneofKind: eventName,
                [eventName]: event,
            },
        })));
    }

    emitMessage(message: LaanaMessage) {
        return Promise.all(this.adapters.map(adapter => adapter.onMessage(message)));
    }

    registerAdapter(adapter: ILaanaNetworkAdapter) {
        this.adapters.push(adapter);
    }

    async registerAdapterAndOpen(adapter: ILaanaNetworkAdapter) {
        this.registerAdapter(adapter);
        await adapter.open();
    }

    async closeSomeAdapters(adaptersToClose: ILaanaNetworkAdapter[]) {
        this.adapters = this.adapters.filter(adapter => !adaptersToClose.includes(adapter));
        await Promise.all(adaptersToClose.map(adapter => adapter.close()));
    }
}
