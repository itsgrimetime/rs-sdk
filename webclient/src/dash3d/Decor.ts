import ModelSource from '#/dash3d/Model.js';

export default class Decor {
    readonly y: number;
    x: number;
    z: number;
    readonly decorType: number;
    readonly decorAngle: number;
    model: ModelSource;
    readonly typecode: number;
    readonly info: number; // byte

    constructor(y: number, x: number, z: number, type: number, angle: number, model: ModelSource, typecode: number, info: number) {
        this.y = y;
        this.x = x;
        this.z = z;
        this.decorType = type;
        this.decorAngle = angle;
        this.model = model;
        this.typecode = typecode;
        this.info = info;
    }
}
