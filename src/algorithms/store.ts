/**
 * losslesspack - Store Algorithm (Raw Pass-Through)
 * Algorithm ID: 0
 */

import { AlgorithmId } from "../format.js";
import { AlgorithmEngine } from "./types.js";

export class StoreEngine implements AlgorithmEngine {
  readonly id = AlgorithmId.STORE;
  readonly name = "store" as const;

  async compress(input: Buffer): Promise<Buffer> {
    return Buffer.from(input);
  }

  async decompress(input: Buffer): Promise<Buffer> {
    return Buffer.from(input);
  }
}
