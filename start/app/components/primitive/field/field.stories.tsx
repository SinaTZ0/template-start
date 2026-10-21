import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "../input/input";
import { Textarea } from "../textarea/textarea";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "./field";
import { twOrientation } from "./field.styles";

const orientationOptions = Object.keys(twOrientation) as Array<keyof typeof twOrientation>;

/*===== Meta =====*/
const meta = {
  title: "Primitive/Field",
  component: Field,
  argTypes: {
    orientation: {
      control: "select",
      options: orientationOptions,
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
    <FieldGroup>
      <Field {...args}>
        <FieldLabel htmlFor="full-name">نام و نام خانوادگی</FieldLabel>
        <Input id="full-name" placeholder="مثال: سارا احمدی" />
        <FieldDescription>مطابق شناسنامه وارد کنید.</FieldDescription>
      </Field>
    </FieldGroup>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const Invalid: Story = {
  render: (args) => (
    <Field {...args} data-invalid>
      <FieldLabel htmlFor="phone">شماره موبایل</FieldLabel>
      <Input id="phone" type="tel" dir="ltr" defaultValue="۰۹۱۲" aria-invalid />
      <FieldError>شماره موبایل باید ۱۱ رقم باشد.</FieldError>
    </Field>
  ),
};

// Several messages are de-duplicated and shown as a list.
export const ErrorList: Story = {
  render: (args) => (
    <Field {...args} data-invalid>
      <FieldLabel htmlFor="password">رمز عبور</FieldLabel>
      <Input id="password" type="password" aria-invalid />
      <FieldError
        errors={[
          { message: "رمز عبور حداقل ۸ نویسه باشد." },
          { message: "یک عدد هم داشته باشد." },
          { message: "رمز عبور حداقل ۸ نویسه باشد." },
        ]}
      />
    </Field>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <Field {...args} data-disabled>
      <FieldLabel htmlFor="email">ایمیل</FieldLabel>
      <Input id="email" disabled defaultValue="sara@example.com" />
    </Field>
  ),
};

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  render: (args) => (
    <Field {...args}>
      <input id="reminders" type="checkbox" />
      <FieldContent>
        <FieldLabel htmlFor="reminders">یادآور رویدادها</FieldLabel>
        <FieldDescription>یک روز قبل از هر رویداد پیامک می‌گیرید.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};

export const FormSection: Story = {
  render: (args) => (
    <FieldSet>
      <FieldLegend>اطلاعات تحصیلی</FieldLegend>
      <FieldDescription>این اطلاعات فقط برای کارشناس آموزش نمایش داده می‌شود.</FieldDescription>
      <FieldGroup>
        <Field {...args}>
          <FieldLabel htmlFor="major">رشته تحصیلی</FieldLabel>
          <Input id="major" placeholder="مثال: مهندسی کامپیوتر" />
        </Field>
        <FieldSeparator>اختیاری</FieldSeparator>
        <Field {...args}>
          <FieldLabel htmlFor="notes">توضیحات</FieldLabel>
          <Textarea id="notes" placeholder="زمینه‌های پژوهشی، سوابق آموزشی…" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};
