import type { Meta, StoryObj } from "@storybook/react-vite";

import { Label } from "../label/label";
import { Textarea } from "./textarea";

/*===== Meta =====*/
const meta = {
  title: "Primitive/Textarea",
  component: Textarea,
  args: {
    placeholder: "مثال: درخواست تمدید مهلت تحویل پایان‌نامه…",
    "aria-label": "شرح درخواست",
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="request">شرح درخواست</Label>
      <Textarea {...args} id="request" aria-label={undefined} />
    </div>
  ),
};

export const Filled: Story = {
  args: {
    defaultValue: "به دلیل بیماری در امتحان میان‌ترم شرکت نکردم و درخواست امتحان مجدد دارم.",
  },
};

export const Invalid: Story = {
  args: { "aria-invalid": true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
