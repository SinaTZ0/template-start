import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "../button/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { twVariant } from "./alert.styles";

const variantOptions = Object.keys(twVariant) as Array<keyof typeof twVariant>;

/*===== Meta =====*/
const meta = {
  title: "Primitive/Alert",
  component: Alert,
  argTypes: {
    variant: {
      control: "select",
      options: variantOptions,
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>اطلاعیه</AlertTitle>
      <AlertDescription>انتخاب واحد نیم‌سال دوم از ۱۵ بهمن آغاز می‌شود.</AlertDescription>
    </Alert>
  ),
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

// Each status tone travels with its own icon and a title, never colour alone.
export const Tones: Story = {
  render: () => (
    <div className="grid gap-3">
      <Alert variant="info">
        <InfoIcon />
        <AlertTitle>اطلاعیه</AlertTitle>
        <AlertDescription>انتخاب واحد نیم‌سال دوم از ۱۵ بهمن آغاز می‌شود.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <CircleCheckIcon />
        <AlertTitle>ثبت شد</AlertTitle>
        <AlertDescription>درخواست شما با شماره پیگیری ۴۵۸۱۲ ثبت شد.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>مهلت رو به پایان است</AlertTitle>
        <AlertDescription>برای پرداخت شهریه تا پایان روز پنجشنبه فرصت دارید.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <Alert {...args}>
      <CircleAlertIcon />
      <AlertTitle>پرداخت انجام نشد</AlertTitle>
      <AlertDescription>ارتباط با درگاه برقرار نشد. لطفاً دوباره تلاش کنید.</AlertDescription>
    </Alert>
  ),
};

export const WithoutIcon: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>اطلاعات شما محرمانه می‌ماند</AlertTitle>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>جلسه دفاع فردا ساعت ۱۰</AlertTitle>
      <AlertDescription>دانشکده فنی و مهندسی، تالار شماره ۲</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          جزئیات
        </Button>
      </AlertAction>
    </Alert>
  ),
};
