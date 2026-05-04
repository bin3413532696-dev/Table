import type { CreateTaskInput, UpdateTaskInput } from './schema';
import { createTask, findTaskById, listTasks, softDeleteTask, updateTask } from './repository';
import { toTaskDto } from './dto';
import { kickProjectionRuntime } from '../projection/runtime';

export async function getTaskList() {
  const tasks = await listTasks();
  return tasks.map(toTaskDto);
}

export async function createTaskRecord(input: CreateTaskInput) {
  const task = await createTask(input);
  kickProjectionRuntime();
  return toTaskDto(task);
}

export async function getTaskDetail(id: string) {
  const task = await findTaskById(id);
  return task ? toTaskDto(task) : null;
}

export async function updateTaskRecord(id: string, input: UpdateTaskInput) {
  const existing = await findTaskById(id);
  if (!existing) {
    return null;
  }
  const task = await updateTask(id, input);
  kickProjectionRuntime();
  return toTaskDto(task);
}

export async function deleteTaskRecord(id: string) {
  const existing = await findTaskById(id);
  if (!existing) {
    return null;
  }
  const task = await softDeleteTask(id);
  kickProjectionRuntime();
  return toTaskDto(task);
}
