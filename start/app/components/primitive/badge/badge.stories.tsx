import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheckIcon, StarIcon } from "lucide-react";

import { Badge } from "./badge";
import { twVariant } from "./badge.styles";

const variantOptions = Object.keys(twVariant) as Array<keyof typeof twVariant>;

/*===== Meta =====*/
const meta = {
  title: "Primitive/Badge",
  component: Badge,
  argTypes: {
    variant: { control: "select", options: variantOptions },
  },
  args: { children: "برچسب" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {variantOptions.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

// Status tones travel with an icon and a word, never colour alone.
export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-3">
      <Badge variant="success">
        <CircleCheckIcon data-icon="inline-start" />
        ثبت شد
      </Badge>
      <Badge variant="gold">
        <StarIcon data-icon="inline-start" />
        ویژه
      </Badge>
    </div>
  ),
};
