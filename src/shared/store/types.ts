import { BaseEntity, EntityId, CrudResult } from '../../core/types';

export interface IStore<T extends BaseEntity, CreateDTO, UpdateDTO> {
  getAll(): Promise<T[]>;
  getById(id: EntityId): Promise<T | undefined>;
  create(data: CreateDTO): Promise<CrudResult<T>>;
  update(id: EntityId, data: UpdateDTO): Promise<CrudResult<T>>;
  delete(id: EntityId): Promise<CrudResult<void>>;
  count(): Promise<number>;
}

export interface StoreConfig {
  storageKey: string;
  typeName: string;
  autoSync?: boolean;
}

export interface IncrementalUpdate<T> {
  added: T[];
  updated: T[];
  removed: EntityId[];
}
