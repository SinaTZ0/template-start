import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "./input";
import { Label } from "../label/label";

/*===== Meta =====*/
const meta = {
  title: "Primitive/Input",
  component: Input,
  args: { placeholder: "نام و نام خانوادگی", "aria-label": "نام و نام خانوادگی" },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="full-name">نام و نام خانوادگی</Label>
      <Input {...args} id="full-name" aria-label={undefined} />
    </div>
  ),
};

export const Filled: Story = {
  args: { defaultValue: "سارا احمدی" },
};

// Phone numbers stay LTR inside the RTL layout.
export const Phone: Story = {
  args: {
    type: "tel",
    dir: "ltr",
    placeholder: "۰۹۱۲ ۳۴۵ ۶۷۸۹",
    "aria-label": "شماره موبایل",
  },
};

export const Invalid: Story = {
  args: { defaultValue: "۰۹۱۲", "aria-invalid": true },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "سارا احمدی" },
};
