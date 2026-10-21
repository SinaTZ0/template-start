import type { Meta, StoryObj } from "@storybook/react-vite";
import { MapPinIcon, SearchIcon, XIcon } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";

/*===== Meta =====*/
const meta = {
  title: "Primitive/InputGroup",
  component: InputGroup,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const WithIcon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="جستجو در سایت" aria-label="جستجو در سایت" />
    </InputGroup>
  ),
};

export const WithButton: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <MapPinIcon />
      </InputGroupAddon>
      <InputGroupInput defaultValue="ساختمان مرکزی، طبقه دوم" aria-label="محل برگزاری" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="پاک کردن">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithText: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput dir="ltr" placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹" aria-label="شماره موبایل" />
      <InputGroupAddon align="inline-end">
        <InputGroupText dir="ltr">+۹۸</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea placeholder="شرح درخواست" aria-label="شرح درخواست" />
      <InputGroupAddon align="block-end">
        <InputGroupText>۰ / ۳۰۰</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const Invalid: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput aria-invalid defaultValue="؟" aria-label="جستجو در سایت" />
    </InputGroup>
  ),
};
