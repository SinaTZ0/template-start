import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";
import { twTriggerSize } from "./select.styles";

const sizeOptions = Object.keys(twTriggerSize) as Array<keyof typeof twTriggerSize>;

/*===== Data =====*/
const species = [
  { value: "engineering", label: "فنی و مهندسی" },
  { value: "science", label: "علوم پایه" },
  { value: "humanities", label: "علوم انسانی" },
  { value: "arts", label: "هنر و معماری" },
  { value: "other", label: "سایر دانشکده‌ها" },
];

/*===== Meta =====*/
const meta = {
  title: "Primitive/Select",
  component: SelectTrigger,
  argTypes: {
    size: { control: "inline-radio", options: sizeOptions },
  },
  args: { size: "default" },
  render: (args) => (
    <Select items={species}>
      <SelectTrigger {...args} className="w-full max-w-sm" aria-label="دانشکده">
        <SelectValue placeholder="دانشکده" />
      </SelectTrigger>
      <SelectContent>
        {species.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
} satisfies Meta<typeof SelectTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const Small: Story = {
  args: { size: "sm" },
};

export const Grouped: Story = {
  render: (args) => (
    <Select items={species}>
      <SelectTrigger {...args} className="w-full max-w-sm" aria-label="دانشکده">
        <SelectValue placeholder="دانشکده" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>دانشکده‌های اصلی</SelectLabel>
          {species.slice(0, 2).map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>سایر</SelectLabel>
          {species.slice(2).map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Invalid: Story = {
  args: { "aria-invalid": true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
