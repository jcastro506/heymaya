"use client";

import { useEffect, useRef, useState } from "react";
import "devices.css/dist/devices.css";
import "./phone-conversation.css";

const lines = [
  {
    who: "maya",
    text: "@brettconti just did 4.6× his normal with a “do i regret it yet?” cut. that shape is yours: months into walking central london, same question.",
  },
  { who: "maya", text: "20 seconds over your thames footage, original audio. today at 5?" },
  { who: "you", text: "oh that’s good. yeah let’s do it" },
  { who: "maya", text: "on your calendar. i’ll nudge you at 4:45 with the shot list." },
];

export default function PhoneConversation() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(lines.length);
  const [typing, setTyping] = useState(false);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const timers: ReturnType<typeof setTimeout>[] = [];
    let observer: IntersectionObserver | undefined;
    const stop = () => {
      timers.forEach(clearTimeout);
      setCount(lines.length);
      setTyping(false);
    };
    const play = () => {
      if (preference.matches) return;
      setCount(0);
      setTyping(false);
      let time = 450;
      lines.forEach((line, index) => {
        if (line.who === "maya") {
          timers.push(setTimeout(() => setTyping(true), time));
          time += 1500;
        }
        timers.push(
          setTimeout(() => {
            setTyping(false);
            setCount(index + 1);
          }, time),
        );
        time += 1400;
      });
    };
    if (!preference.matches && ref.current && window.IntersectionObserver) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            play();
            observer?.disconnect();
          }
        },
        { threshold: 0.45 },
      );
      observer.observe(ref.current);
    }
    preference.addEventListener("change", stop);
    return () => {
      timers.forEach(clearTimeout);
      observer?.disconnect();
      preference.removeEventListener("change", stop);
    };
  }, [replay]);

  return (
    <div className="iphone-demo" ref={ref}>
      <div className="iphone-demo-size">
        <div className="device device-iphone-14-pro">
          <div className="device-frame">
            <div className="device-screen im-screen">
              <div className="im-status" aria-hidden="true">
                <b>9:41</b>
                <span>▮▮▮ ▰</span>
              </div>
              <div className="im-contact">
                <span className="im-back" aria-hidden="true">
                  ‹
                </span>
                <span className="im-avatar">m</span>
                <span>
                  Maya <span aria-hidden="true">›</span>
                </span>
              </div>
              <div className="im-thread" aria-hidden="true">
                <div className="im-date">Today 9:41 AM</div>
                {lines.slice(0, count).map((line, index) => (
                  <div
                    key={`${replay}-${index}`}
                    className={`im-bubble im-${line.who}`}
                  >
                    {line.text}
                  </div>
                ))}
                {typing && (
                  <div className="im-typing">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>
              <div className="im-compose" aria-hidden="true">
                <span>＋</span>
                <div>
                  Message<span>↑</span>
                </div>
              </div>
              <div className="im-home" aria-hidden="true" />
            </div>
          </div>
          <div className="device-stripe" />
          <div className="device-header" />
          <div className="device-sensors" />
          <div className="device-btns" />
          <div className="device-power" />
        </div>
      </div>
      <div className="im-transcript">
        Illustrative conversation.{" "}
        {lines.map((line, index) => (
          <p key={index}>
            {line.who === "maya" ? "Maya" : "You"}: {line.text}
          </p>
        ))}
      </div>
      <button
        type="button"
        className="im-replay"
        onClick={() => setReplay((value) => value + 1)}
      >
        ↻ Replay conversation
      </button>
    </div>
  );
}
