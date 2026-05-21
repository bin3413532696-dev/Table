import type { CreateFinanceRecordInput, UpdateFinanceRecordInput } from './schema';
import {
  createFinanceRecord,
  findFinanceRecordById,
  listFinanceRecords,
  deleteFinanceRecord,
  updateFinanceRecord,
} from './repository';
import { toFinanceRecordDto } from './dto';
import { ensureMutationResult } from '../../shared/conflict';

export async function getFinanceList() {
  const records = await listFinanceRecords();
  return records.map(toFinanceRecordDto);
}

export async function createFinanceRecordEntry(input: CreateFinanceRecordInput) {
  const record = await createFinanceRecord(input);
  return toFinanceRecordDto(record);
}

export async function getFinanceRecordDetail(id: string) {
  const record = await findFinanceRecordById(id);
  return record ? toFinanceRecordDto(record) : null;
}

export async function updateFinanceRecordEntry(id: string, input: UpdateFinanceRecordInput) {
  const existing = await findFinanceRecordById(id);
  const record = await updateFinanceRecord(id, input);
  const ensured = ensureMutationResult(
    existing,
    record,
    'Finance record was modified by another request. Please refresh and try again.'
  );
  return ensured ? toFinanceRecordDto(ensured) : null;
}

export async function deleteFinanceRecordEntry(id: string) {
  const existing = await findFinanceRecordById(id);
  if (!existing) {
    return null;
  }
  const record = await deleteFinanceRecord(id);
  return record ? toFinanceRecordDto(record) : null;
}
