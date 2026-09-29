import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";

import { Button } from "./Button";

const meta = {
  component: Button,
  args: { children: "保存", onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { tone: "primary" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "保存" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Neutral: Story = {
  args: { tone: "neutral" },
};
