import type { TaskRecord } from './contracts';

/** Only settled tasks can be removed; an unknown submission may still be running. */
export function canRemoveTask(status: TaskRecord['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'interrupted';
}
