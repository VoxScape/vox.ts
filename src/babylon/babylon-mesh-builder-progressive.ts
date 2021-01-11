import { Mesh } from '@babylonjs/core/Meshes';
import { Scene } from '@babylonjs/core/scene';
import { Color4, Quaternion } from '@babylonjs/core/Maths';
import { BabylonDeps } from './babylon-deps';
import * as VoxTypes from '../types/vox-types';
import { buildBabylonColor } from './util';
import { createVoxelIndex } from '../util/create-voxel-index';

export interface BabylonMeshBuildProgress {
  startAt: number;
  root: Mesh;
  finishAt?: number;

  progress: number;
}

const Neighbors = [
  /* dx, dy, dz */
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
] as const;

/**
 * @internal
 * @param {VoxelModel} model
 * @param {VoxelPalette} palette
 * @param {string} meshName
 * @param {Scene} scene
 * @param deps
 * @param {number} maxWorkPeriod
 * @returns {Generator<BabylonMeshBuildProgress>}
 */
export function* buildBabylonMeshProgressive(
  model: VoxTypes.VoxelModel,
  palette: VoxTypes.VoxelPalette,
  meshName: string,
  scene: Scene,
  deps: BabylonDeps,
  batchSize = 0,
): Generator<BabylonMeshBuildProgress> {
  const { Mesh, MeshBuilder, Vector3, Color4, Matrix } = deps;

  // vox (or MagicaVoxel): x-right / y-'deep' / z-top
  // babylon: x-right / z-'deep' / y-top
  const root = new Mesh(meshName, scene);

  {
    const 〇 = 0;
    const x = model.size.x + 1;
    const y = model.size.y + 1;
    const z = model.size.z + 1;
    const frame = MeshBuilder.CreateLineSystem(
      'frame',
      {
        lines: [
          [
            new Vector3(〇, 〇, 〇),
            new Vector3(x, 〇, 〇),
            new Vector3(x, y, 〇),
            new Vector3(〇, y, 〇),
            new Vector3(〇, 〇, 〇),
            new Vector3(〇, 〇, z),
            new Vector3(〇, y, z),
            new Vector3(x, y, z),
            new Vector3(x, 〇, z),
            new Vector3(x, 〇, 〇),
          ],
        ],
      },
      scene,
    );
    frame.parent = root;
  }

  /**
   * a transform that swaps y/z
   * 1 0 0 0
   * 0 0 1 0
   * 0 1 0 0
   * 0 0 0 1
   * @type {Matrix}
   */
  const m = Matrix.FromValues(
    1,
    0,
    0,
    0, //
    0,
    0,
    1,
    0, //
    0,
    1,
    0,
    0, //
    -(model.size.x + 1) / 2, // translation-x
    -(model.size.z + 1) / 2,
    -(model.size.y + 1) / 2,
    1, //
  );

  if (1) {
    const scale = new Vector3();
    const rotation = new Quaternion();
    const translation = new Vector3();
    m.decompose(scale, rotation, translation);
    console.log('decomposed', scale, rotation, translation);

    root.position = translation;
    root.rotationQuaternion = rotation;
    root.scaling = scale;
  }

  const progress: BabylonMeshBuildProgress = {
    startAt: Date.now(),
    root,
    progress: 0,
  };

  yield progress;

  let numSubMesh = 0;
  for (const c of extractSurfaces(model.voxels, palette, batchSize, deps)) {
    const subMesh = MeshBuilder.CreatePolyhedron(`submesh-${++numSubMesh}`, c);
    subMesh.parent = root; // must preserve local transform of subMesh

    yield {
      ...progress,
      progress: c.progress,
    };
  }

  yield {
    ...progress,
    progress: 1,
    finishAt: Date.now(),
  };
}

interface CustomPolyhedronProps {
  faceColors: Color4[];
  custom: {
    vertex: [number, number, number][];
    face: [number, number, number][];
  };
}

function* extractSurfaces(
  voxels: readonly VoxTypes.Voxel[],
  palette: VoxTypes.VoxelPalette,
  batchSize: number,
  deps: BabylonDeps,
): Generator<CustomPolyhedronProps & { progress: number }> {
  const { Color4 } = deps;
  const voxelIndex = createVoxelIndex(voxels);

  const faceColors: Color4[] = [];
  const vertex: [number, number, number][] = [];
  const face: [number, number, number][] = [];

  let numProcessedVoxels = 0;

  /** FIXME: we should merge faces when possible */

  for (const x of voxelIndex.keys()) {
    for (const y of voxelIndex.get(x)!.keys()) {
      for (const [z, v] of voxelIndex.get(x)!.get(y)!) {
        /**
         * notation:
         * voxel {x=a, y=b, z=c} corresponds to box {a<=x<a+1, b<=y<b+1, c-1<=z<c+1}
         */
        const vertexOffset = vertex.length;

        let numCreatedFaces = 0;

        for (const [dx, dy, dz] of Neighbors) {
          if (
            // discard this face if it's covered
            voxelIndex
              .get(x + dx)
              ?.get(y + dy)
              ?.has(z + dz)
          ) {
            continue;
          }

          if (dx === -1) {
            face.push(
              [vertexOffset + 0, vertexOffset + 4, vertexOffset + 6],
              [vertexOffset + 6, vertexOffset + 2, vertexOffset + 0],
            );
            ++numCreatedFaces;
          } else if (dx === 1) {
            face.push(
              [vertexOffset + 1, vertexOffset + 3, vertexOffset + 7],
              [vertexOffset + 7, vertexOffset + 5, vertexOffset + 1],
            );
            ++numCreatedFaces;
          } else if (dy === -1) {
            face.push(
              [vertexOffset + 5, vertexOffset + 4, vertexOffset + 0],
              [vertexOffset + 0, vertexOffset + 1, vertexOffset + 5],
            );
            ++numCreatedFaces;
          } else if (dy === 1) {
            face.push(
              [vertexOffset + 3, vertexOffset + 2, vertexOffset + 6],
              [vertexOffset + 6, vertexOffset + 7, vertexOffset + 3],
            );
            ++numCreatedFaces;
          } else if (dz === -1) {
            face.push(
              [vertexOffset + 0, vertexOffset + 2, vertexOffset + 3],
              [vertexOffset + 3, vertexOffset + 1, vertexOffset + 0],
            );
            ++numCreatedFaces;
          } else if (dz === 1) {
            face.push(
              [vertexOffset + 5, vertexOffset + 7, vertexOffset + 6],
              [vertexOffset + 6, vertexOffset + 4, vertexOffset + 5],
            );
            ++numCreatedFaces;
          }
        }

        if (numCreatedFaces) {
          vertex.push(
            [x, y, z], // offset
            [x + 1, y, z],
            [x, y + 1, z],
            [x + 1, y + 1, z],
            [x, y, z + 1], // offset+4
            [x + 1, y, z + 1],
            [x, y + 1, z + 1],
            [x + 1, y + 1, z + 1],
          );

          const color = buildBabylonColor(palette[v.colorIndex], Color4);

          // 1 face = 2 colored facets
          for (let i = 0; i < numCreatedFaces; i++) {
            faceColors.push(color, color);
          }
        }

        if (batchSize && !(++numProcessedVoxels % batchSize)) {
          // interrupt
          const progress = numProcessedVoxels / voxels.length;
          yield {
            progress: numProcessedVoxels / voxels.length,
            faceColors: faceColors.splice(0, faceColors.length),
            custom: {
              vertex: vertex.splice(0, vertex.length),
              face: face.splice(0, face.length),
            },
          };
        }
      }
    }
  }

  yield {
    progress: 1,
    faceColors,
    custom: {
      vertex,
      face,
    },
  };
}
