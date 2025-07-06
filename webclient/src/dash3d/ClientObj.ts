import ModelSource from '#/dash3d/ModelSource.ts';

export default class ClientObj extends ModelSource {
    readonly index: number;
    count: number;

    constructor(index: number, count: number) {
        super();
        this.index = index;
        this.count = count;
    }
}
