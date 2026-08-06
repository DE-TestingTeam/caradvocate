/**
 * The shape every dialog write shares. Four things have to happen around a save, and missing
 * any is a bug the user sees: hold the saving flag across the call so the button cannot be
 * pressed twice, invalidate the queries, close the dialog, and turn a rejection into a toast
 * rather than an unhandled promise.
 *
 * Not used by RepairCompletedDialog, which writes on open rather than submit and renders its
 * failure in the dialog body.
 */
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { invalidateAll } from './useApi';

export interface WriteState {
  /** True while a write is in flight. Disables the submit button. */
  saving: boolean;
  /** Runs one write, then refreshes and closes. `failure` is used when the rejection has no message. */
  write: (action: () => Promise<unknown>, success: string, failure: string) => Promise<void>;
}

export function useWrite(close: () => void): WriteState {
  const [saving, setSaving] = React.useState(false);
  const toast = useToast();

  async function write(action: () => Promise<unknown>, success: string, failure: string) {
    setSaving(true);
    try {
      await action();
      invalidateAll();
      close();
      toast(success);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : failure);
    } finally {
      setSaving(false);
    }
  }

  return { saving, write };
}
