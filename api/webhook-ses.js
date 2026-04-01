const { get, set } = require('./_redis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // SNS sends a JSON body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  // Confirm SNS subscription if needed
  if (body.Type === 'SubscriptionConfirmation') {
    const confirmUrl = body.SubscribeURL;
    console.log('Confirming SNS Subscription:', confirmUrl);
    await fetch(confirmUrl);
    return res.status(200).send('OK');
  }

  // Handle SES Notifications
  if (body.Type === 'Notification') {
    const message = JSON.parse(body.Message);
    const notificationType = message.notificationType; // Bounce, Complaint, or Delivery

    if (notificationType === 'Bounce' || notificationType === 'Complaint') {
      const mail = message.mail;
      const recipients = mail.destination; // Array of emails
      
      const bounceType = message.bounce ? message.bounce.bounceType : null;
      const complaintFeedbackType = message.complaint ? message.complaint.complaintFeedbackType : null;
      
      const newStatus = notificationType === 'Bounce' ? 'BOUNCED' : 'COMPLAINT';
      console.log(`SES Webhook: ${notificationType} for ${recipients.join(', ')}`);

      try {
        // 1. Get current leads
        const rawLeads = await get('crm:leads');
        if (rawLeads) {
          let leads = JSON.parse(rawLeads);
          let updated = false;

          // 2. Mark leads by email
          leads.forEach(l => {
            if (recipients.includes(l.email)) {
              l.status = newStatus;
              l.notes = (l.notes || '') + `\n[${new Date().toISOString()}] SES ${newStatus}: ${bounceType || complaintFeedbackType || ''}`;
              updated = true;
            }
          });

          // 3. Save back if changed
          if (updated) {
            await set('crm:leads', JSON.stringify(leads));
            console.log('CRM Leads updated via SES Webhook');
          }
        }
      } catch (err) {
        console.error('SES Webhook Redis update failed:', err);
      }
    }
  }

  res.status(200).send('OK');
};
