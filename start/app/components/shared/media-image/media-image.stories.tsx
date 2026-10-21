import type { Meta, StoryObj } from "@storybook/react-vite";

import placeholderImage from "~/assets/placeholder.svg";
import { MediaImage } from "~/components/shared/media-image/media-image";
import type { Media } from "~/orpc/media/contract";

/*===== Fixtures =====*/
// A tiny inline stand-in for the 16 px WebP placeholder, so the story shows it without any network.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='12'><rect width='16' height='12' fill='#2563eb'/><rect width='8' height='6' fill='#93c5fd'/></svg>`,
  );

const sampleMedia: Media = {
  id: "00000000-0000-4000-8000-000000000000",
  kind: "image",
  width: 800,
  height: 600,
  placeholder: PLACEHOLDER,
  urls: {
    thumb: placeholderImage,
    card: placeholderImage,
    full: placeholderImage,
  },
};

/*===== Meta =====*/
const meta = {
  title: "Shared/MediaImage",
  component: MediaImage,
  args: { media: sampleMedia, variant: "card", alt: "تصویر نمونه" },
  argTypes: {
    variant: { control: "select", options: ["thumb", "card", "full"] },
  },
  render: (args) => (
    <div className="max-w-sm">
      <MediaImage {...args} />
    </div>
  ),
} satisfies Meta<typeof MediaImage>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Card: Story = { args: { className: "w-full rounded-xl" } };

export const Thumb: Story = { args: { variant: "thumb", className: "size-20 rounded-full" } };

/** The `full` variant keeps the photo's own aspect ratio instead of cropping it. */
export const FullKeepsAspectRatio: Story = { args: { variant: "full", className: "h-auto w-full rounded-xl" } };

/** A broken URL leaves the blurred placeholder behind, so the box is never empty. */
export const PlaceholderWhileLoading: Story = {
  args: {
    media: { ...sampleMedia, urls: { ...sampleMedia.urls, card: "/demo/does-not-exist.jpg" } },
    className: "w-full rounded-xl",
  },
};
