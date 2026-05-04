import type { CreateFinanceRecordInput, UpdateFinanceRecordInput } from './schema';
import {
  createFinanceRecord,
  findFinanceRecordById,
  listFinanceRecords,
  softDeleteFinanceRecord,
  updateFinanceRecord,
} from './repository';
import { toFinanceRecordDto } from './dto';
import { kickProjectionRuntime } from '../projection/runtime';

export async function getFinanceList() {
  const records = await listFinanceRecords();
  return records.map(toFinanceRecordDto);
}

export async function createFinanceRecordEntry(input: CreateFinanceRecordInput) {
  const record = await createFinanceRecord(input);
  kickProjectionRuntime();
  return toFinanceRecordDto(record);
}

export async function getFinanceRecordDetail(id: string) {
  const record = await findFinanceRecordById(id);
  return record ? toFinanceRecordDto(record) : null;
}

export async function updateFinanceRecordEntry(id: string, input: UpdateFinanceRecordInput) {
  const existing = await findFinanceRecordById(id);
  if (!existing) {
    return null;
  }
  const record = await updateFinanceRecord(id, input);
  kickProjectionRuntime();
  return toFinanceRecordDto(record);
}

export async function deleteFinanceRecordEntry(id: string) {
  const existing = await findFinanceRecordById(id);
  if (!existing) {
    return null;
  }
  const record = await softDeleteFinanceRecord(id);
  kickProjectionRuntime();
  return toFinanceRecordDto(record);
}
