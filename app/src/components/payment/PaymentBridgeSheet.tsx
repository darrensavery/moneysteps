import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  monzoUrl, revolutUrl, paypalUrl, venmoUrl, buildReference,
  type PayPalCurrency,
} from '../../lib/paymentBridge';
import { formatCurrency } from '../../lib/api';
import type { ChildRecord } from '../../lib/api';
import { PaymentTileGrid, type Provider } from './PaymentTileGrid';
import { DeepLinkHandler } from './DeepLinkHandler';
import { SmartCopyPanel } from './SmartCopyPanel';
import { PaymentConfirmSheet } from './PaymentConfirmSheet';
import { getDetails } from '../../lib/localBankDetails';

type Props = {
  open: boolean;
  onClose: () => void;
  familyId: string;
  child: ChildRecord;
  completionIds: string[];
  totalMinorUnits: number;
  currency: string;
  onPaid: () => void; // refresh unpaid summary after successful stamp
};

type Row = { label: string; value: string };

type View =
  | { kind: 'grid' }
  | { kind: 'deep-link-pending'; provider: Provider; url: string }
  | { kind: 'deep-link-fallback'; provider: Provider; rows: Row[] }
  | { kind: 'bank-copy'; rows: Row[] }
  | { kind: 'zelle-copy'; rows: Row[] }
  | { kind: 'confirm' };

export function PaymentBridgeSheet(props: Props) {
  const {
    open, onClose, familyId, child,
    completionIds, totalMinorUnits, currency, onPaid,
  } = props;

  const [view, setView] = useState<View>({ kind: 'grid' });
  const amountMajor = (totalMinorUnits / 100).toFixed(2);
  const reference = buildReference(child.display_name);

  // Android hardware Back button — close nested view first, then the sheet.
  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    App.addListener('backButton', () => {
      if (view.kind === 'grid') onClose();
      else setView({ kind: 'grid' });
    }).then((handle) => { remove = () => handle.remove(); });
    return () => { remove?.(); };
  }, [open, view.kind, onClose]);

  // Reset to grid each time the sheet opens.
  useEffect(() => {
    if (open) setView({ kind: 'grid' });
  }, [open]);

  const availability = {
    monzo:   !!child.monzo_handle,
    revolut: !!child.revolut_handle,
    paypal:  !!child.paypal_handle,
    venmo:   !!child.venmo_handle,
    bank:    true,
  };

  function handleTileSelect(p: Provider) {
    if (p === 'bank') {
      const saved = getDetails(familyId, child.id);
      // UK has sort code + account number; US uses Zelle (email/phone).
      if (saved?.zelleHandle && !saved?.sortCode) {
        setView({
          kind: 'zelle-copy',
          rows: [
            { label: 'Zelle (email/phone)', value: saved.zelleHandle },
            { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
            { label: 'Reference', value: reference },
          ],
        });
        return;
      }
      if (saved?.sortCode && saved?.accountNumber) {
        setView({
          kind: 'bank-copy',
          rows: [
            { label: 'Sort Code', value: saved.sortCode },
            { label: 'Account Number', value: saved.accountNumber },
            { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
            { label: 'Reference', value: reference },
          ],
        });
        return;
      }
      // No saved details — prompt the parent inline. V1 minimal form:
      // eslint-disable-next-line no-alert
      alert(`No bank details saved for ${child.display_name}. Add them in the child's profile first.`);
      return;
    }
    if (p === 'monzo' && child.monzo_handle) {
      const url = monzoUrl(child.monzo_handle, amountMajor);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'revolut' && child.revolut_handle) {
      const url = revolutUrl(child.revolut_handle, amountMajor);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'paypal' && child.paypal_handle) {
      const url = paypalUrl(child.paypal_handle, amountMajor, currency as PayPalCurrency);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'venmo' && child.venmo_handle) {
      const url = venmoUrl(child.venmo_handle, amountMajor, reference);
      return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    // No handle → stay on grid; user taps another tile or closes.
  }

  function handleDeepLinkOpened() {
    setView({ kind: 'confirm' });
  }

  function handleDeepLinkFallback(provider: Provider) {
    const rows: Row[] = [
      { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
      { label: 'Recipient', value: child.display_name },
      { label: 'Reference', value: reference },
    ];
    setView({ kind: 'deep-link-fallback', provider, rows });
  }

  function handlePaymentDone() {
    onPaid();
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 bottom-0 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl bg-white pb-safe"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Payment Bridge</Dialog.Title>
          <div className="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-neutral-300" />

          <div className="px-4 pt-1 pb-2">
            <div className="text-[13px] text-neutral-500">Pay {child.display_name}</div>
            <div className="text-[22px] font-bold">
              {formatCurrency(totalMinorUnits, currency)}
              {completionIds.length > 1 && (
                <span className="ml-2 text-[13px] font-normal text-neutral-500">
                  ({completionIds.length} rewards)
                </span>
              )}
            </div>
          </div>

          {view.kind === 'grid' && (
            <PaymentTileGrid onSelect={handleTileSelect} availability={availability} />
          )}

          {view.kind === 'deep-link-pending' && (
            <>
              <div className="px-4 py-6 text-center text-[14px] text-neutral-500">
                Opening your {view.provider} app…
              </div>
              <DeepLinkHandler
                url={view.url}
                onOpened={handleDeepLinkOpened}
                onFallback={() => handleDeepLinkFallback(view.provider)}
              />
            </>
          )}

          {view.kind === 'deep-link-fallback' && (
            <SmartCopyPanel
              rows={view.rows}
              apologyBanner={`Couldn't open ${view.provider}. Copy the details below and switch apps manually.`}
            />
          )}

          {view.kind === 'confirm' && (
            <PaymentConfirmSheet
              familyId={familyId}
              completionIds={completionIds}
              totalMinorUnits={totalMinorUnits}
              currency={currency}
              onDone={handlePaymentDone}
              onCancel={() => setView({ kind: 'grid' })}
            />
          )}

          {view.kind === 'bank-copy' && (
            <>
              <SmartCopyPanel
                rows={view.rows}
                warningBanner="Saved on this device only. We'll upgrade this to encrypted storage soon."
              />
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'confirm' })}
                  className="w-full rounded-2xl bg-neutral-900 py-3 font-semibold text-white"
                >
                  I&apos;ve sent it — next
                </button>
              </div>
            </>
          )}

          {view.kind === 'zelle-copy' && (
            <>
              <SmartCopyPanel
                rows={view.rows}
                warningBanner="Open your banking app and find Zelle to complete the transfer."
              />
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'confirm' })}
                  className="w-full rounded-2xl bg-neutral-900 py-3 font-semibold text-white"
                >
                  I&apos;ve sent it — next
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
