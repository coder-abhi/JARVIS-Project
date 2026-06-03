import { Link as RouterLink, type LinkProps as RouterLinkProps } from "react-router-dom";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: RouterLinkProps["to"];
  children: ReactNode;
};

export default function Link({ href, children, ...props }: NextLinkProps) {
  return (
    <RouterLink to={href} {...props}>
      {children}
    </RouterLink>
  );
}
