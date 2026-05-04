import type { FinanceRecord, Task } from '@prisma/client';
import { toFinanceRecordDto } from '../finance/dto';
import { toTaskDto } from '../tasks/dto';

export type BusinessSnapshotDto = {
  version: number;
  exportedAt: string;
  tasks: ReturnType<typeof toTaskDto>[];
  finance: ReturnType<typeof toFinanceRecordDto>[];
};

export function toBusinessSnapshotDto(input: {
  tasks: Task[];
  finance: FinanceRecord[];
}): BusinessSnapshotDto {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: input.tasks.map(toTaskDto),
    finance: input.finance.map(toFinanceRecordDto),
  };
}
