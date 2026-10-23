import type { Meta, StoryObj } from "@storybook/react-vite";

import { LocaleSwitcher } from "#/components/shared/locale-switcher/locale-switcher";

/*===== Meta =====*/
// The links point nowhere here: in the app they lead to the current page in each other language.
const meta = {
  title: "Shared/LocaleSwitcher",
  component: LocaleSwitcher,
  args: {
    links: [{ locale: "en", name: "English", href: "#" }],
  },
} satisfies Meta<typeof LocaleSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Default: Story = {};

/** From English, the switcher offers Persian. */
export const ToPersian: Story = {
  args: { links: [{ locale: "fa", name: "فارسی", href: "#" }] },
};
