import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { company, issue, type, name, email } = await req.json();

    // Formspree Integration (No library required)
    const FORMSPREE_ID = "mrejabqj";
    
    const response = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        subject: `DARAS ${type}: ${company || name || "User Inquiry"}`,
        name: name || company,
        email: email || "darascomp@gmail.com",
        issue: issue,
        user_type: type,
        _replyto: email || "darascomp@gmail.com",
      }),
    });

    if (response.ok) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: "Formspree submission failed" }, { status: 500 });
    }
  } catch (error) {
    console.error("Support API Error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
