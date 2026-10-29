import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cn } from "#/lib/utils";
import { CircleCheckIcon, InfoIcon, Loader2Icon, CircleAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "#/paraglide/messages";
import { Button } from "../button/button";
import {
  toastActionClasses,
  toastClasses,
  toastCloseClasses,
  toastContentClasses,
  toastDescriptionClasses,
  toastIconClasses,
  toastTextClasses,
  toastTitleClasses,
  toastViewportClasses,
} from "./toast.styles";

/*===== Manager =====*/

/** The app-wide toast manager: call `toast.add({ title, type })` from anywhere, inside or outside React. */
const toast = ToastPrimitive.createToastManager();

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

/*===== Provider and Viewport =====*/

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport data-slot="toast-viewport" className={cn(toastViewportClasses, className)} {...props} />
  );
}

/*===== Toast =====*/

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return <ToastPrimitive.Root data-slot="toast" className={cn(toastClasses, className)} {...props} />;
}

/*===== Compound Parts =====*/

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return <ToastPrimitive.Content data-slot="toast-content" className={cn(toastContentClasses, className)} {...props} />;
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return <ToastPrimitive.Title data-slot="toast-title" className={cn(toastTitleClasses, className)} {...props} />;
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn(toastDescriptionClasses, className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn(toastActionClasses, className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={m.common_close_notification()}
      render={render}
      className={cn(toastCloseClasses, className)}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

/*===== Icon =====*/

const toastIcons: Record<string, ReactNode> = {
  // The status icons, each in its tone colour; the title still carries the meaning in words.
  success: <CircleCheckIcon className="text-success" aria-hidden="true" />,
  info: <InfoIcon className="text-info" aria-hidden="true" />,
  warning: <TriangleAlertIcon className="text-warning" aria-hidden="true" />,
  error: <CircleAlertIcon className="text-destructive" aria-hidden="true" />,
  loading: <Loader2Icon className="animate-spin" aria-hidden="true" />,
};

/** Picks the icon for a toast's `type`; unknown or missing types show no icon. */
function ToastIcon({ type }: { type: string | undefined }) {
  const icon = type ? toastIcons[type] : undefined;
  if (!icon) return null;

  return (
    <span data-slot="toast-icon" className={toastIconClasses}>
      {icon}
    </span>
  );
}

/*===== Toaster =====*/

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className={toastTextClasses}>
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ));
}

/** Mount once near the root. Renders every toast added through `toastManager` (the shared `toast` by default). */
function Toaster({ children, toastManager = toast, ...props }: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
