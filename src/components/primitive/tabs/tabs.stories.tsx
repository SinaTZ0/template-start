import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { twVariant } from "./tabs.styles";

const variantOptions = Object.keys(twVariant) as Array<keyof typeof twVariant>;

/*===== Meta =====*/
const meta = {
  title: "Primitive/Tabs",
  component: TabsList,
  argTypes: {
    variant: {
      control: "select",
      options: variantOptions,
    },
  },
  render: (args) => (
    <Tabs defaultValue="upcoming" className="max-w-sm">
      <TabsList {...args}>
        <TabsTrigger value="upcoming">رویدادهای پیش رو</TabsTrigger>
        <TabsTrigger value="past">گذشته</TabsTrigger>
        <TabsTrigger value="cancelled" disabled>
          لغوشده
        </TabsTrigger>
      </TabsList>
      <TabsContent value="upcoming">همایش ملی هوش مصنوعی، ۲۴ مهر</TabsContent>
      <TabsContent value="past">۱۲ رویداد در ماه گذشته</TabsContent>
      <TabsContent value="cancelled">رویداد لغوشده‌ای وجود ندارد.</TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof TabsList>;

export default meta;
type Story = StoryObj<typeof meta>;

/*===== Stories =====*/
export const Playground: Story = {};

export const Line: Story = {
  args: { variant: "line" },
};

export const Vertical: Story = {
  render: (args) => (
    <Tabs defaultValue="profile" orientation="vertical" className="max-w-md">
      <TabsList {...args}>
        <TabsTrigger value="profile">اطلاعات فردی</TabsTrigger>
        <TabsTrigger value="courses">دروس</TabsTrigger>
        <TabsTrigger value="payments">شهریه</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">نام، شماره دانشجویی و نشانی</TabsContent>
      <TabsContent value="courses">۱۸ واحد در نیم‌سال جاری</TabsContent>
      <TabsContent value="payments">۲ قسط پرداخت‌شده</TabsContent>
    </Tabs>
  ),
};
