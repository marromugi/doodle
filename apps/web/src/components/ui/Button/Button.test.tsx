import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("calls onClick when clicked", async () => {
    const onClick = vi.fn<() => void>();
    render(<Button onClick={onClick}>保存</Button>);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button onClick={onClick} disabled>
        保存
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
