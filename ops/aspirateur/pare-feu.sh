#!/bin/sh
# ops/aspirateur/pare-feu.sh — filtrage sortant de l'utilisateur « aspirateur » (relecture I3), rejoué au démarrage par
# aspirateur-pare-feu.service. Idempotent : chaîne dédiée vidée puis remplie.
# Autorisé : réponses aux connexions entrantes (Traefik), résolution DNS locale, HTTPS sortant vers Internet.
# Refusé : tout le réseau privé, le lien local, la boucle locale (hors DNS), et tout port autre que 443.
set -eu
U=aspirateur
for bin in iptables ip6tables; do
  $bin -N ASPIRATEUR 2>/dev/null || $bin -F ASPIRATEUR
  $bin -C OUTPUT -m owner --uid-owner "$U" -j ASPIRATEUR 2>/dev/null || $bin -A OUTPUT -m owner --uid-owner "$U" -j ASPIRATEUR
  $bin -A ASPIRATEUR -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
done
# IPv4
iptables -A ASPIRATEUR -d 127.0.0.53 -p udp --dport 53 -j RETURN
iptables -A ASPIRATEUR -d 127.0.0.53 -p tcp --dport 53 -j RETURN
for reseau in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 0.0.0.0/8; do
  iptables -A ASPIRATEUR -d "$reseau" -j REJECT
done
iptables -A ASPIRATEUR -p tcp --dport 443 -j RETURN
iptables -A ASPIRATEUR -j REJECT
# IPv6
for reseau in ::1/128 fc00::/7 fe80::/10; do
  ip6tables -A ASPIRATEUR -d "$reseau" -j REJECT
done
ip6tables -A ASPIRATEUR -p tcp --dport 443 -j RETURN
ip6tables -A ASPIRATEUR -j REJECT
