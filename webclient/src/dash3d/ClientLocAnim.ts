import SeqType from '#/config/SeqType.js';

import ModelSource from '#/dash3d/ModelSource.ts';

export default class ClientLocAnim extends ModelSource {
    heightmapSW: number;
    readonly heightmapSE: number;
    readonly heightmapNE: number;
    readonly heightmapNW: number;
    readonly index: number;
    readonly seq: SeqType;
    seqFrame: number;
    seqCycle: number;

    constructor(index: number, heightmapSW: number, heightmapSE: number, heightmapNE: number, heightmapNW: number, seq: number, randomFrame: boolean) {
        super();

        this.heightmapSW = heightmapSW;
        this.heightmapSE = heightmapSE;
        this.heightmapNE = heightmapNE;
        this.heightmapNW = heightmapNW;
        this.index = index;

        this.seq = SeqType.types[seq];
        this.seqFrame = 0;
        this.seqCycle = 0; // Client.loopCycle

        if (randomFrame && this.seq.replayoff !== -1 && this.seq.delay) {
            this.seqFrame = (Math.random() * this.seq.frameCount) | 0;
            this.seqCycle = (Math.random() * this.seq.delay[this.seqFrame]) | 0;
        }
    }
}
