import DoublyLinkable from '#/datastruct/DoublyLinkable.js';
import type VertexNormal from '#/dash3d/VertexNormal.js';

export default class ModelSource extends DoublyLinkable {
    public vertexNormal: (VertexNormal | null)[] | null = null;
    public minY: number = 1000;

    drawTemp() {
    }

    getTempModel() {
        return null;
    }
}
