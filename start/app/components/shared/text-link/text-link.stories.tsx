import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextLink } from "~/components/shared/text-link/text-link";
import { twTone } from "./text-link.styles";

const toneOptions = Object.keys(twTone) as Array<keyof typeof twTone>;

/*===== Meta =====*/
const meta = {
  title: "Shared/TextLink",
  component: TextLink,
  argTypes: {
    tone: { control: "inline-radio", options: toneOptions },
  },
  args: { href: "#more", children: "مشاهده همه", tone: "default" },
} satisfies Meta<typeof TextLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/

// Hover or tab to the link: the label tints one step and the arrow nudges 4px forward.
export const Playground: Story = {};

// Without `href` the text link is a call inside a link card: it reacts to the card's hover instead of its own.
export const CallInsideLink: Story = {
  render: () => (
    <a
      href="#news"
      className="block max-w-xs rounded-md bg-card p-5 shadow-sm ring-1 ring-border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <span className="block text-h4">عنوان یک کارت</span>
      <TextLink className="mt-2">ادامه مطلب</TextLink>
    </a>
  ),
};
