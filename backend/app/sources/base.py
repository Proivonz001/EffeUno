"""Interfaccia astratta della sorgente dati.

Il replay storico (direzione B) e il live (direzione C) devono poter
convivere dietro questa interfaccia: il frontend consuma sempre gli stessi
payload, cambia solo da dove arrivano i campioni.
"""

from abc import ABC, abstractmethod
from typing import Any


class LoadedSession(ABC):
    """Una sessione caricata e interrogabile."""

    @abstractmethod
    def info(self) -> dict[str, Any]:
        """Metadati: evento, anno, tipo sessione, piloti."""

    @abstractmethod
    def replay(self) -> dict[str, Any]:
        """Posizioni X/Y di tutti i piloti, tempi relativi allo start.

        Formato: {duration_s, track: [[x,y],...],
                  track_status: [[t, codice],...],
                  drivers: [{num, abbr, team, points: [[t,x,y],...],
                             pits: [[t_in,t_out],...],
                             laps: [[n, t_inizio, t_fine],...]}]}
        """

    @abstractmethod
    def laps(self) -> list[dict[str, Any]]:
        """Lista giri: pilota, numero, tempo, compound."""

    @abstractmethod
    def lap_telemetry(self, driver: str, lap: int) -> dict[str, Any]:
        """Canali telemetria di un giro, allineati per distanza."""

    def feed(self) -> dict[str, Any]:
        """Feed cronologico: messaggi direzione gara, clip team radio e
        campioni meteo. Facoltativo: default liste vuote."""
        return {"race_control": [], "radio": [], "weather": []}


class DataSource(ABC):
    """Fabbrica di sessioni. L'implementazione FastF1 legge lo storico;
    una futura implementazione live consumera' il feed SignalR."""

    @abstractmethod
    def events(self, year: int) -> list[dict[str, Any]]:
        """Calendario di una stagione."""

    @abstractmethod
    def load_session(self, year: int, event: str, session: str) -> LoadedSession:
        """Carica una sessione (bloccante, puo' richiedere secondi)."""
