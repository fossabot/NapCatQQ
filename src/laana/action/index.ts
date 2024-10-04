import { LaanaActionPing, LaanaActionPong } from '@laana-proto/def';

type ExtractFromPongOrVoid<key> = Extract<LaanaActionPong['pong'], { oneofKind: key; }> extends never ?
    void :
    // eslint-disable-next-line
    // @ts-ignore
    Extract<LaanaActionPong['pong'], { oneofKind: key; }>[key];

type LaanaActionMapping = {
    [key in Exclude<LaanaActionPing['ping']['oneofKind'], undefined>]:
    (
        params:
            // eslint-disable-next-line
            // @ts-ignore
            Extract<LaanaActionPing['ping'], { oneofKind: key; }>[key]
    ) => PromiseLike<ExtractFromPongOrVoid<key>>;
};

export type LaanaActionHandler = Partial<LaanaActionMapping>;
