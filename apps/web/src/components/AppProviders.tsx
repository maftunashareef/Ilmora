'use client'
import type { ReactNode } from 'react'
import { type InitialData, StoreProvider } from '@/store/useStore'
import { PasswordChangeRedirect } from './PasswordChange'
import { RevealManager, TableCardLabels, ThemeApplier, Toasts } from './System'

/** Client root: per-request store hydrated with the server-fetched site + catalog, theme variables, motion system, toasts. */
export function AppProviders({ initial, children }: { initial: InitialData; children: ReactNode }) {
  return (
    <StoreProvider initial={initial}>
      <ThemeApplier />
      <RevealManager />
      <TableCardLabels />
      <PasswordChangeRedirect />
      {children}
      <Toasts />
    </StoreProvider>
  )
}
