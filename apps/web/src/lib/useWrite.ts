/**
 * The shape every dialog write shares.
 *
 * Four things have to happen around a save, and missing any one of them is a bug the
 * user sees: the saving flag has to be held across the call so the button cannot be
 * pressed twice, the queries have to be invalidated or the page shows stale data, the
 * dialog has to close, and a rejection has to become a toast rather than an unhandled
 * promise. Writing that out per action meant four near-identical copies.
 *
 * Deliberately not used by RepairCompletedDialog: that one writes when it opens
 * rather than on a submit, and renders its failure in the dialog body instead of a
 * toast, so it has none of this shape to share.
 */
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { invalidateAll } from './useApi';

export interface WriteState {
  /** True while a write is in flight. Disables the submit button. */
  saving: boolean;
  /**
   * Runs one write, then refreshes and closes.
   *
   * `failure` is the message shown when the rejection carries none of its own.
   */
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
