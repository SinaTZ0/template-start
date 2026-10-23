import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../button/button";
import { createToastManager, Toaster } from "./toast";

/*===== Meta =====*/

// Each story uses its own manager, so toasts from one story don't leak into another.
const meta = {
  title: "Primitive/Toast",
  component: Toaster,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/

const typesManager = createToastManager();

export const Types: Story = {
  args: { toastManager: typesManager },
  render: (args) => (
    <Toaster {...args}>
      <div className="flex flex-wrap gap-3 p-6">
        <Button onClick={() => typesManager.add({ title: "مطلب منتشر شد.", type: "success" })}>موفق</Button>
        <Button
          variant="outline"
          onClick={() =>
            typesManager.add({ title: "انتخاب واحد از ۱۵ بهمن", description: "سامانه آموزشی", type: "info" })
          }
        >
          اطلاع
        </Button>
        <Button
          variant="outline"
          onClick={() => typesManager.add({ title: "مهلت پرداخت شهریه فردا تمام می‌شود.", type: "warning" })}
        >
          هشدار
        </Button>
        <Button
          variant="destructive"
          onClick={() => typesManager.add({ title: "ذخیره انجام نشد. دوباره تلاش کنید.", type: "error" })}
        >
          خطا
        </Button>
        <Button variant="secondary" onClick={() => typesManager.add({ title: "در حال ارسال...", type: "loading" })}>
          در حال انجام
        </Button>
      </div>
    </Toaster>
  ),
};

const actionManager = createToastManager();

export const WithAction: Story = {
  args: { toastManager: actionManager },
  render: (args) => (
    <Toaster {...args}>
      <div className="p-6">
        <Button
          onClick={() =>
            actionManager.add({
              title: "مطلب به بایگانی رفت.",
              actionProps: { children: "بازگردانی" },
            })
          }
        >
          بایگانی مطلب
        </Button>
      </div>
    </Toaster>
  ),
};
