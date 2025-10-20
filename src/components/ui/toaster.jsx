import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // 仅渲染打开状态的 toast；关闭状态不再显示以实现自动消失
        if (props.open === false) return null;
        return (
          <Toast key={id} data-state={props.open ? 'open' : 'closed'} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose onClick={() => props.onOpenChange?.(false)} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}