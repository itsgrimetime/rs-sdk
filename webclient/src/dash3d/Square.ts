import Linkable from '#/datastruct/Linkable.js';

import GroundDecor from '#/dash3d/GroundDecor.js';
import Sprite from '#/dash3d/Sprite.js';
import GroundObject from '#/dash3d/GroundObject.js';
import Ground from '#/dash3d/Ground.js';
import QuickGround from '#/dash3d/QuickGround.js';
import Wall from '#/dash3d/Wall.js';
import Decor from '#/dash3d/Decor.js';

import { TypedArray1d } from '#/util/Arrays.js';

export default class Square extends Linkable {
    // constructor
    groundLevel: number;
    readonly x: number;
    readonly z: number;
    readonly occludeLevel: number;
    readonly locs: (Sprite | null)[];
    readonly locSpan: Int32Array;

    // runtime
    underlay: QuickGround | null = null;
    overlay: Ground | null = null;
    wall: Wall | null = null;
    wallDecoration: Decor | null = null;
    groundDecoration: GroundDecor | null = null;
    objStack: GroundObject | null = null;
    bridge: Square | null = null;
    locCount: number = 0;
    locSpans: number = 0;
    drawLevel: number = 0;
    groundVisible: boolean = false;
    update: boolean = false;
    containsLocs: boolean = false;
    checkLocSpans: number = 0;
    blockLocSpans: number = 0;
    inverseBlockLocSpans: number = 0;
    backWallTypes: number = 0;

    constructor(level: number, x: number, z: number) {
        super();
        this.occludeLevel = this.groundLevel = level;
        this.x = x;
        this.z = z;
        this.locs = new TypedArray1d(5, null);
        this.locSpan = new Int32Array(5);
    }
}
