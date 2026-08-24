import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ThemeProvider } from "../ThemeProvider";
import HeroSection from "../components/HeroSection";
import { WorldMap } from "../components/ui/map";
import TravelConnectSignIn from "../components/ui/travel-connect-signin-1";

const DOTS = [
  {
    start: { lat: 31.7683, lng: 35.2137, label: "Jerusalem" },
    end: { lat: 32.0853, lng: 34.7818, label: "Tel Aviv" },
  },
];

describe("HeroSection", () => {
  it("renders heading, feature bullets and get-started button", () => {
    render(
      <ThemeProvider>
        <HeroSection onGetStarted={() => {}} />
      </ThemeProvider>
    );
    expect(screen.getByText(/Arrive safer/i)).toBeInTheDocument();
    expect(screen.getByTestId("get-started-btn")).toBeInTheDocument();
  });

  it("top-right sign-in button navigates to the login page", () => {
    const onSignIn = vi.fn();
    render(
      <ThemeProvider>
        <HeroSection onGetStarted={() => {}} onSignIn={onSignIn} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByTestId("hero-signin-btn"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("WorldMap draws one animated path per dot", () => {
    render(
      <ThemeProvider>
        <WorldMap dots={DOTS} lineColor="#F97316" />
      </ThemeProvider>
    );
    const paths = document.querySelectorAll('path[stroke="url(#path-gradient)"]');
    expect(paths.length).toBe(DOTS.length);
    expect(paths[0].getAttribute("d")).toContain("M");
    expect(screen.getAllByText("Jerusalem").length).toBeGreaterThan(0);
  });
});

describe("TravelConnectSignIn", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders welcome heading and sign-in controls", () => {
    render(<TravelConnectSignIn onSignIn={() => {}} />);
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getByTestId("signin-submit-btn")).toBeInTheDocument();
    expect(screen.queryByText(/login with google/i)).not.toBeInTheDocument();
  });

  it("offers a sign-up tab that reveals registration fields", async () => {
    render(<TravelConnectSignIn onSignIn={() => {}} />);
    fireEvent.click(screen.getByTestId("tab-signup"));
    await waitFor(() =>
      expect(screen.getByText(/create your account/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByTestId("signin-submit-btn")).toHaveTextContent(
      /create account/i
    );

    fireEvent.click(screen.getByTestId("tab-signin"));
    await waitFor(() =>
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    );
  });

  it("creates an account via sign-up and signs the user in", async () => {
    const onSignIn = vi.fn();
    render(<TravelConnectSignIn onSignIn={onSignIn} />);
    fireEvent.click(screen.getByTestId("tab-signup"));
    await waitFor(() =>
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Suresh Kumar" },
    });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "new.user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "strongpass123" },
    });
    fireEvent.click(screen.getByTestId("signin-submit-btn"));
    expect(onSignIn).toHaveBeenCalledWith("new.user@example.com", "Suresh Kumar");
  });

  it("rejects sign-in with an unregistered email and prompts sign-up", async () => {
    const onSignIn = vi.fn();
    render(<TravelConnectSignIn onSignIn={onSignIn} />);
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "ghost@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "whatever123" },
    });
    fireEvent.click(screen.getByTestId("signin-submit-btn"));
    expect(await screen.findByTestId("auth-error")).toHaveTextContent(
      /no account found/i
    );
    // Auto-switched to the sign-up form so the user can register.
    await waitFor(() =>
      expect(screen.getByText(/create your account/i)).toBeInTheDocument()
    );
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("rejects sign-in with a wrong password for an existing account", async () => {
    const onSignIn = vi.fn();
    const { unmount } = render(<TravelConnectSignIn onSignIn={onSignIn} />);
    // Register first
    fireEvent.click(screen.getByTestId("tab-signup"));
    await waitFor(() =>
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Existing User" },
    });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "existing@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByTestId("signin-submit-btn"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    unmount();

    // Fresh mount → try signing in with a wrong password
    const onSignIn2 = vi.fn();
    render(<TravelConnectSignIn onSignIn={onSignIn2} />);
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "existing@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByTestId("signin-submit-btn"));
    expect(await screen.findByTestId("auth-error")).toHaveTextContent(
      /incorrect password/i
    );
    expect(onSignIn2).not.toHaveBeenCalled();
  });
});

