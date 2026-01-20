import nodemailer from 'nodemailer';
import { appConfig } from '../config/config';

const transporter = nodemailer.createTransport({
  host: appConfig.smtpHost,
  port: appConfig.smtpPort,
  secure: appConfig.smtpPort === 465,
  auth: {
    user: appConfig.smtpUser,
    pass: appConfig.smtpPass,
  },
});

export async function sendMagicLink(email: string, token: string): Promise<void> {
  const magicLink = `${appConfig.appUrl}/auth/verify?token=${token}`;

  await transporter.sendMail({
    from: appConfig.emailFrom,
    to: email,
    subject: 'Login to Bear Valley Run Checks',
    html: `
      <h2>Login to Bear Valley Run Checks</h2>
      <p>Click the link below to log in. This link will expire in 15 minutes.</p>
      <p><a href="${magicLink}">Login Now</a></p>
      <p>If you didn't request this email, you can safely ignore it.</p>
      <p style="color: #666; font-size: 12px;">
        Or copy this link: ${magicLink}
      </p>
    `,
  });
}

export async function sendWelcomeEmail(email: string, token: string): Promise<void> {
  const magicLink = `${appConfig.appUrl}/auth/verify?token=${token}`;

  await transporter.sendMail({
    from: appConfig.emailFrom,
    to: email,
    subject: 'Welcome to Bear Valley Run Checks',
    html: `
      <h2>Welcome to Bear Valley Run Checks!</h2>
      <p>An admin has created an account for you. Click the link below to log in for the first time.</p>
      <p><a href="${magicLink}">Login Now</a></p>
      <p>This link will expire in 15 minutes. You can request a new login link anytime from the login page.</p>
      <p style="color: #666; font-size: 12px;">
        Or copy this link: ${magicLink}
      </p>
    `,
  });
}
