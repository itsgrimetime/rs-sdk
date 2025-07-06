import Linkable from '#/datastruct/Linkable.js';

export default class LocChange extends Linkable {
    duration: number = -1;

    locIndex: number = 0;
    locAngle: number = 0;
    shape: number = 0;

    plane: number = 0;
    layer: number = 0;
    x: number = 0;
    z: number = 0;

    lastLocIndex: number = 0;
    lastAngle: number = 0;
    lastShape: number = 0;

    delay: number = 0;
}
