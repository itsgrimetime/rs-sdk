import Model from '#/dash3d/Model.js';

export default class GroundObject {
    readonly y: number;
    readonly x: number;
    readonly z: number;
    readonly topObj: Model | null;
    readonly middleObj: Model | null;
    readonly bottomObj: Model | null;
    readonly typecode: number;
    readonly offset: number;

    constructor(y: number, x: number, z: number, topObj: Model | null, middleObj: Model | null, bottomObj: Model | null, typecode: number, offset: number) {
        this.y = y;
        this.x = x;
        this.z = z;
        this.topObj = topObj;
        this.middleObj = middleObj;
        this.bottomObj = bottomObj;
        this.typecode = typecode;
        this.offset = offset;
    }
}
