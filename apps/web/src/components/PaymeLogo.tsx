import { cx } from './ui/helpers'

/**
 * Payme's own logo (the provider's file, kept in /public/brand), on a light plate so it reads on any background.
 * Shown where the visitor pays: beside the cart total and on the checkout page.
 */
export function PaymeLogo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center rounded-control bg-paper px-3.5 py-2 shadow-soft', className)}>
      <img src="/brand/payme.svg" alt="Payme" width={87} height={30} className="h-[30px] w-auto" />
    </span>
  )
}
