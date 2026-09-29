import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<"button">, "className" | "style"> & {
  tone?: "primary" | "neutral";
};

const toneClass = {
  primary: "bg-black text-white",
  neutral: "bg-white text-black border border-black",
} as const;

export function Button({ tone = "neutral", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`rounded px-3 py-1 ${toneClass[tone]}`}
      {...rest}
    />
  );
}
